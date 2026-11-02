// Terrain generation. Pure, synchronous, deterministic.
//
// HARD CONTRACT: terrainAt(seed, cx, cy, cz) returns a Uint8Array(4096) that is
// bit-identical for the same arguments on every machine, every run, forever.
//
// Decoupling: this file runs inside Web Workers from L3 on, so it must not see the
// renderer or the main-thread world. No `three`, no main-thread world state. The only
// allowed imports are src/core/rng.ts (all randomness), design/config.ts, src/gen/biomes.ts,
// src/world/blocks.ts (a pure constant registry: block IDs by name) and the pure-JS
// `simplex-noise` package (pinned exact in package.json; no DOM, no globals).
// Math.random is banned in this directory.
//
// ---------------------------------------------------------------------------------------
// NOISE SETUP (the golden hashes depend on this exact order; do not reorder)
//
//   const rng     = rngFromSeed(seed);   // cyrb128(seed)[0] -> splitmix32
//   const noise2D = createNoise2D(rng);  // draws #1..#255   (permutation table shuffle)
//   const noise3D = createNoise3D(rng);  // draws #256..#510 (permutation table shuffle)
//
// ONE rng instance feeds both. noise2D is built first, so it owns the first 255 draws and
// noise3D the next 255. Swapping the two lines, or giving each its own rngFromSeed(seed),
// changes every cave. simplex-noise's default `random` is Math.random, so the rng argument
// is mandatory: never call createNoiseXD() without it.
//
// Since L4 the height noise2D is owned by src/gen/biomes.ts (it builds the same table with
// createNoise2D(rngFromSeed(seed))). This file still creates and discards one so that noise3D
// receives exactly the draws it always did: caves are byte-identical to L3.
//
// Determinism notes: simplex-noise uses only + - * / and Math.floor / Math.sqrt, all exactly
// specified by IEEE-754 / ECMAScript (no sin/cos/exp, whose last bit may vary by engine).
// Every frequency divisor below is a power of two, so x/128, y/16, x/32 are exact.
// ---------------------------------------------------------------------------------------
//
// SURFACE (L4): see src/gen/biomes.ts. columnAt(seed, x, z) gives each column its biome
//   (plains / forest / mountains, soft-blended per ADR-0013), its surface height h, its top
//   block (grass, stone, or snow above SNOW_CAP_Y) and its 3 sub-layers (dirt or stone).
//   h is within [SURFACE_Y_MIN, SURFACE_Y_MAX] = [-10, 118] for every seed. The origin column
//   has relief 0 (n(0,0) = 0) but it is no longer a fixed 32: the foothill ramp lifts it, to 41
//   for most seeds and 45 for the rest (the gradient of the weight noise at the origin takes
//   one of two magnitudes). The origin is always FOREST.
//
// CAVES (3D, unchanged since L3): |noise3D(x/32, y/16, z/32)| < 0.08 carves air. The smaller y
//   divisor stretches features horizontally (squashed in y), giving tunnel-ish rather than
//   blobby caves. Caves only carve STONE (world y < h-3). The surface block and the 3 layers
//   under it are never carved, so caves are sealed from the surface: no cave mouths.
//
// TREES (L4): forest chunks grow BIOMES.FOREST_TREES_PER_CHUNK trees (biomes.ts treesInChunk).
//   A canopy reaches 2 blocks sideways, so each chunk stamps the trees rooted in its own and the
//   8 neighbouring chunk columns, clipped to itself. Stamping is order-independent: leaves only
//   fill air above ground, logs also replace leaves. Trees never overwrite terrain.
//   LAYER ORDER: heightmap + caves first, trees last, snow decided with the column. Do not move
//   the biome layer in front of the cave pass.

import { createNoise2D, createNoise3D } from "simplex-noise";
import type { NoiseFunction3D } from "simplex-noise";
import { WORLD } from "../../design/config";
import { rngFromSeed } from "../core/rng";
import { BLOCKS } from "../world/blocks";
import { SURFACE_Y_MIN, columnAt, treeBlocks, treeTopY, treesInChunk } from "./biomes";
import type { TreeSpot } from "./biomes";

// Block IDs by name from the one registry (src/world/blocks.ts). If it renumbers, the golden
// hashes in tests/unit/terrain.test.ts change loudly; the names here stay right.
const AIR = BLOCKS.air;
const STONE = BLOCKS.stone;
const WOOD = BLOCKS.wood;
const LEAVES = BLOCKS.leaves;

const S = WORLD.CHUNK_SIZE; // 16, locked by ADR-0002
const SS = S * S;
const CHUNK_VOLUME = S * S * S; // 4096

// Cave tuning.
const CAVE_DIVISOR_XZ = 32;
const CAVE_DIVISOR_Y = 16;
const CAVE_THRESHOLD = 0.08;

const DIRT_DEPTH = 3; // dirt occupies world y in [h-3, h-1]

interface NoiseSet {
  noise3D: NoiseFunction3D;
}

// Memoises noise construction per seed (building two permutation tables is ~510 rng draws;
// doing it per chunk would dominate). The noise functions are immutable after construction,
// so reuse can never change output. Bounded so a long session with many seeds cannot leak.
const NOISE_CACHE_MAX = 4;
const noiseCache = new Map<string, NoiseSet>();

function noiseFor(seed: string): NoiseSet {
  const hit = noiseCache.get(seed);
  if (hit) return hit;

  const rng = rngFromSeed(seed);
  createNoise2D(rng); // FIRST: draws #1..#255. The L3 height table, now built by biomes.ts; burned here.
  const noise3D = createNoise3D(rng); // SECOND: draws #256..#510
  const made: NoiseSet = { noise3D };

  if (noiseCache.size >= NOISE_CACHE_MAX) noiseCache.clear();
  noiseCache.set(seed, made);
  return made;
}

function requireInts(fn: string, what: string, ...v: number[]): void {
  // Reject NaN / Infinity / fractions instead of silently generating a wrong chunk.
  // Throwing is itself deterministic.
  for (const n of v) {
    if (!Number.isInteger(n)) {
      throw new RangeError(`${fn}: ${what} must be integers, got (${v.join(", ")})`);
    }
  }
}

/** Trees rooted in chunk column (cx, cz) and its 8 neighbours: all that can touch this chunk. */
function treesNear(seed: string, cx: number, cz: number): TreeSpot[] {
  const out: TreeSpot[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const t of treesInChunk(seed, cx + dx, cz + dz)) out.push(t);
    }
  }
  return out;
}

/**
 * Chunk terrain as a flat block-ID array.
 * Flat index: x + z*16 + y*256 (local coords, each 0..15).
 *
 * With wx/wy/wz the world coords of a voxel and h, top, under = surface height, top block and
 * sub-layer block of its column (columnAt in biomes.ts):
 *   wy >  h       -> air (or a tree)
 *   wy == h       -> top   (grass, or stone in mountains, or snow above SNOW_CAP_Y)
 *   h-3 <= wy < h -> under (dirt, or stone in mountains)
 *   wy <  h-3     -> stone, unless the 3D cave noise carves it to air
 * then trees are stamped into the air above ground.
 *
 * A chunk's local y=0 sits at world y = cy*16. Surfaces live in world y -10..118, trees rise up
 * to 7 above them; every chunk above that is guaranteed all air.
 *
 * Every call returns a fresh, exactly-4096-byte ArrayBuffer-backed array (byteOffset 0)
 * so callers can transfer it to/from a Worker without copying or aliasing.
 */
export function terrainAt(seed: string, cx: number, cy: number, cz: number): Uint8Array {
  requireInts("terrainAt", "chunk coords", cx, cy, cz);

  const out = new Uint8Array(CHUNK_VOLUME); // zero-filled: air
  const { noise3D } = noiseFor(seed);

  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;

  // Pass 1: one column per (x,z): height and the two materials, plus the tallest column.
  const heights = new Int32Array(SS);
  const tops = new Uint8Array(SS);
  const unders = new Uint8Array(SS);
  let maxY = -Infinity;
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const col = columnAt(seed, x0 + lx, z0 + lz);
      const i = lx + lz * S;
      heights[i] = col.height;
      tops[i] = col.surface;
      unders[i] = col.subsurface;
      if (col.height > maxY) maxY = col.height;
    }
  }

  // Trees can only matter when this chunk reaches above the lowest possible ground.
  const trees = y0 + S - 1 > SURFACE_Y_MIN ? treesNear(seed, cx, cz) : [];
  for (const t of trees) {
    const top = treeTopY(t);
    if (top > maxY) maxY = top;
  }

  // Exact shortcut: if the chunk floor is above every surface and tree top, the full loops
  // below would also leave every voxel as air. Skips ~all work for sky chunks.
  if (y0 > maxY) return out;

  // Pass 2: fill. The 3D noise is only evaluated for voxels that are deep enough to be
  // stone, which is where caves are allowed.
  for (let ly = 0; ly < S; ly++) {
    const wy = y0 + ly;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const i = lx + lz * S;
        const h = heights[i]!;
        if (wy > h) continue; // air (already 0)

        let block: number;
        if (wy === h) {
          block = tops[i]!;
        } else if (wy >= h - DIRT_DEPTH) {
          block = unders[i]!;
        } else {
          const n = noise3D(
            (x0 + lx) / CAVE_DIVISOR_XZ,
            wy / CAVE_DIVISOR_Y,
            (z0 + lz) / CAVE_DIVISOR_XZ,
          );
          block = Math.abs(n) < CAVE_THRESHOLD ? AIR : STONE;
        }
        out[i + ly * SS] = block;
      }
    }
  }

  // Pass 3: trees. Only cells strictly above their own column's ground are written, so terrain
  // (and the sealed caves under it) is never touched. Leaves fill air only; logs fill air or
  // leaves, so the result does not depend on the order trees are stamped in.
  for (const t of trees) {
    if (t.baseY + 1 > y0 + S - 1 || treeTopY(t) < y0) continue; // misses this chunk vertically
    for (const c of treeBlocks(t.trunk)) {
      const lx = t.x + c.dx - x0;
      const lz = t.z + c.dz - z0;
      const wy = t.baseY + c.dy;
      if (lx < 0 || lx >= S || lz < 0 || lz >= S || wy < y0 || wy >= y0 + S) continue;
      const i = lx + lz * S;
      if (wy <= heights[i]!) continue; // hillside: ground wins
      const at = i + (wy - y0) * SS;
      if (c.block === WOOD) {
        if (out[at] === AIR || out[at] === LEAVES) out[at] = WOOD;
      } else if (out[at] === AIR) {
        out[at] = LEAVES;
      }
    }
  }

  return out;
}

/**
 * World y of the top solid block (grass, stone or snow) of the column (x, z), exactly as
 * terrainAt places it. Same seed + same fields as terrainAt, so callers (player spawn, tests)
 * never have to re-derive the heightmap. Integer world coords only. Trees are not included.
 */
export function surfaceHeightAt(seed: string, x: number, z: number): number {
  requireInts("surfaceHeightAt", "world coords", x, z);
  return columnAt(seed, x, z).height;
}

/**
 * Thin async wrapper so callers can already `await` it; becomes a real Worker
 * round-trip later. Resolves to exactly what terrainAt returns.
 */
export function terrainAtAsync(
  seed: string,
  cx: number,
  cy: number,
  cz: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      resolve(terrainAt(seed, cx, cy, cz));
    } catch (e) {
      reject(e);
    }
  });
}
