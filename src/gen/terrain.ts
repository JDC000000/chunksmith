// Terrain generation. Pure, synchronous, deterministic.
//
// HARD CONTRACT: terrainAt(seed, cx, cy, cz) returns a Uint8Array(4096) that is
// bit-identical for the same arguments on every machine, every run, forever.
//
// Decoupling: this file runs inside Web Workers from L3 on, so it must not see the
// renderer or the main-thread world. No `three`, no `src/world/` imports. The only
// allowed imports are src/core/rng.ts (all randomness), design/config.ts, and the
// pure-JS `simplex-noise` package (pinned exact in package.json; no DOM, no globals).
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
// changes every byte of terrain. simplex-noise's default `random` is Math.random, so the
// rng argument is mandatory: never call createNoiseXD() without it.
//
// Determinism notes: simplex-noise uses only + - * / and Math.floor / Math.sqrt, all exactly
// specified by IEEE-754 / ECMAScript (no sin/cos/exp, whose last bit may vary by engine).
// Every frequency divisor below is a power of two, so x/128, y/16, x/32 are exact.
// ---------------------------------------------------------------------------------------
//
// HEIGHTMAP (2D, one noise2D sampled at three scales, summed coarse to fine):
//   h(x,z) = floor( 32 + 24*n(x/128,z/128) + 12*n(x/64,z/64) + 6*n(x/32,z/32) )
//   Addition order is left to right exactly as written (float add is not associative).
//   n is strictly inside (-1, 1), so h is always within [-10, 74] (32 +/- 42); in practice
//   roughly -8..71. n(0,0) = 0, so h(0,0) = 32 for EVERY seed.
//
// CAVES (3D): |noise3D(x/32, y/16, z/32)| < 0.08 carves air. The smaller y divisor stretches
//   features horizontally (squashed in y), giving tunnel-ish rather than blobby caves.
//   Caves only carve STONE (world y < h-3). Grass and the 3 dirt layers are never carved, so
//   caves are sealed from the surface: there are no cave mouths in this version.

import { createNoise2D, createNoise3D } from "simplex-noise";
import type { NoiseFunction2D, NoiseFunction3D } from "simplex-noise";
import { WORLD } from "../../design/config";
import { rngFromSeed } from "../core/rng";

// Block IDs, hard-coded to stay decoupled from src/world/.
// Source of truth: src/world/blocks.ts (BLOCKS = { air:0, grass:1, dirt:2, stone:3 }).
// Known gotcha, accepted: if blocks.ts renumbers, update these AND the golden hashes.
const AIR = 0;
const GRASS = 1;
const DIRT = 2;
const STONE = 3;

const S = WORLD.CHUNK_SIZE; // 16, locked by ADR-0002
const SS = S * S;
const CHUNK_VOLUME = S * S * S; // 4096

// Heightmap tuning. Frequency is stored as its power-of-two reciprocal (divisor) so the
// scaling is exact in floating point.
const HEIGHT_BASE = 32;
const OCTAVE_DIVISOR = [128, 64, 32] as const; // freq 1/128, 1/64, 1/32
const OCTAVE_AMPLITUDE = [24, 12, 6] as const;

// Cave tuning.
const CAVE_DIVISOR_XZ = 32;
const CAVE_DIVISOR_Y = 16;
const CAVE_THRESHOLD = 0.08;

const DIRT_DEPTH = 3; // dirt occupies world y in [h-3, h-1]

interface NoiseSet {
  noise2D: NoiseFunction2D;
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
  const noise2D = createNoise2D(rng); // FIRST: draws #1..#255
  const noise3D = createNoise3D(rng); // SECOND: draws #256..#510
  const made: NoiseSet = { noise2D, noise3D };

  if (noiseCache.size >= NOISE_CACHE_MAX) noiseCache.clear();
  noiseCache.set(seed, made);
  return made;
}

/** World surface height (integer y of the grass block) for the column (x, z). */
function columnHeight(noise2D: NoiseFunction2D, x: number, z: number): number {
  let h = HEIGHT_BASE;
  for (let i = 0; i < 3; i++) {
    const d = OCTAVE_DIVISOR[i]!;
    h += OCTAVE_AMPLITUDE[i]! * noise2D(x / d, z / d);
  }
  return Math.floor(h);
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

/**
 * Chunk terrain as a flat block-ID array.
 * Flat index: x + z*16 + y*256 (local coords, each 0..15).
 *
 * L3 rolling hills + caves. With wx/wy/wz the world coords of a voxel and
 * h = surface height of its column (see HEIGHTMAP above):
 *   wy >  h       -> air
 *   wy == h       -> grass
 *   h-3 <= wy < h -> dirt
 *   wy <  h-3     -> stone, unless the 3D cave noise carves it to air
 *
 * A chunk's local y=0 sits at world y = cy*16. Surfaces live in world y -10..74, i.e.
 * chunks cy -1..4; every chunk with cy >= 5 is guaranteed all air.
 *
 * Every call returns a fresh, exactly-4096-byte ArrayBuffer-backed array (byteOffset 0)
 * so callers can transfer it to/from a Worker without copying or aliasing.
 */
export function terrainAt(seed: string, cx: number, cy: number, cz: number): Uint8Array {
  requireInts("terrainAt", "chunk coords", cx, cy, cz);

  const out = new Uint8Array(CHUNK_VOLUME); // zero-filled: air
  const { noise2D, noise3D } = noiseFor(seed);

  const x0 = cx * S;
  const y0 = cy * S;
  const z0 = cz * S;

  // Pass 1: one height per (x,z) column, plus the tallest column in this chunk.
  const heights = new Int32Array(SS);
  let maxH = -Infinity;
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const h = columnHeight(noise2D, x0 + lx, z0 + lz);
      heights[lx + lz * S] = h;
      if (h > maxH) maxH = h;
    }
  }

  // Exact shortcut: if the chunk floor is above every column's surface, the full loop
  // below would also leave every voxel as air. Skips ~all work for sky chunks.
  if (y0 > maxH) return out;

  // Pass 2: fill. The 3D noise is only evaluated for voxels that are deep enough to be
  // stone, which is where caves are allowed.
  for (let ly = 0; ly < S; ly++) {
    const wy = y0 + ly;
    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const h = heights[lx + lz * S]!;
        if (wy > h) continue; // air (already 0)

        let block: number;
        if (wy === h) {
          block = GRASS;
        } else if (wy >= h - DIRT_DEPTH) {
          block = DIRT;
        } else {
          const n = noise3D(
            (x0 + lx) / CAVE_DIVISOR_XZ,
            wy / CAVE_DIVISOR_Y,
            (z0 + lz) / CAVE_DIVISOR_XZ,
          );
          block = Math.abs(n) < CAVE_THRESHOLD ? AIR : STONE;
        }
        out[lx + lz * S + ly * SS] = block;
      }
    }
  }

  return out;
}

/**
 * World y of the grass block for the column (x, z), exactly as terrainAt places it.
 * Same seed + same noise setup as terrainAt, so callers (player spawn, tests) never have to
 * re-derive the heightmap. Integer world coords only.
 */
export function surfaceHeightAt(seed: string, x: number, z: number): number {
  requireInts("surfaceHeightAt", "world coords", x, z);
  return columnHeight(noiseFor(seed).noise2D, x, z);
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
