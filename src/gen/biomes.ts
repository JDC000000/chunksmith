// Biomes (L4 Day 2, ADR-0013 "noise-mixed weights, soft blend bands") + forest trees.
// Pure, synchronous, deterministic. Runs inside Web Workers: no `three`, no DOM, no Math.random.
// All randomness comes from src/core/rng.ts (cyrb128 + splitmix32).
//
// ---------------------------------------------------------------------------------------
// THE FIELD
//
//   w(x,z) = weightNoise(x * WEIGHT_NOISE_SCALE, z * WEIGHT_NOISE_SCALE)     // about -1..1
//   weightNoise = createNoise2D(splitmix32(cyrb128(seed)[1]))                 // its OWN stream
//
// The weight field is a separate simplex table seeded from the SECOND word of cyrb128(seed).
// The L3 tables (height noise2D, cave noise3D) are fed from the FIRST word (see terrain.ts) and
// are untouched, so caves stay byte-identical to L3. Changing this stream index, the scale, or
// the two thresholds below is a world-identity break (tests/unit/biomes.test.ts pins them).
//
//   biomeAt:   w < -0.33  -> PLAINS      -0.33 <= w < 0.33 -> FOREST      w >= 0.33 -> MOUNTAINS
//   n(0,0) = 0 for every seed, so the origin (spawn) is always FOREST.
//
// ---------------------------------------------------------------------------------------
// THE BLEND (ADR-0013, with the unit mismatch in its pseudocode resolved)
//
// The ADR divides a noise-unit distance (w - 0.33) by TRANSITION_SOFTNESS_BLOCKS, which mixes
// units (w is ~[-1,1], softness is blocks). Here the distance to a border is converted to
// blocks first, to first order:   d = (w - threshold) / |grad w|,   |grad w| in w per block,
// from a central difference (+/- 1 block). d1 is signed distance to the plains|forest border,
// d2 to the forest|mountains border (positive on the far side). All maths is + - * / sqrt
// (exactly specified by IEEE-754; no Math.hypot/pow/sin, whose last bit may vary by engine).
//
//   weight(mountains) = smoothstep(-SOFT, +SOFT, d2)          SOFT = TRANSITION_SOFTNESS_BLOCKS
//   weight(plains)    = 1 - smoothstep(-SOFT, +SOFT, d1)
//   weight(forest)    = 1 - the other two                      (always sums to 1)
//
// Each border is a band centred on the threshold, SOFT blocks to either side, where the two
// biomes mix. The dominant weight is the biomeAt answer (ties at exactly w == threshold
// resolve by the thresholds above).
//
// ---------------------------------------------------------------------------------------
// THE HEIGHT
//
//   relief(x,z) = 24*n(x/128,z/128) + 12*n(x/64,z/64) + 6*n(x/32,z/32)      L3 hills, |.| < 42
//   up          = smoothstep(-FOOTHILL, +FOOTHILL, d2)                       0 .. 1
//   base        = 32 * (1 + (MOUNTAIN_HEIGHT_MULT - 1) * up)                 32 .. 76.8
//   rough       = settle(border distance) blend of per-biome roughness       0.35 .. 1
//   H           = base + rough * relief          h = floor(H)
//
//   - MOUNTAIN_HEIGHT_MULT scales the plains baseline (32), so deep mountains sit near
//     32 * 2.4 = 76.8 before relief. It ramps in over +/- FOOTHILL blocks around the border, so
//     mountains rise as foothills instead of a wall.
//   - Roughness per biome: plains PLAINS_ROUGHNESS, forest 1, mountains 1 (weight-blended).
//   - Near ANY border the roughness is pulled down to PLAINS_ROUGHNESS and recovers to full
//     over SETTLE blocks. That is what keeps US-L4-02 true: the L3 hills alone have 8-neighbour
//     steps > 2 about 1% of the time, and a quickly changing amplitude on top of +/-30 m relief
//     makes more. Settling the ground at the seam removes them at borders.
//   - FOOTHILL = 4 * SOFT and SETTLE = 2 * SOFT. These two multipliers are LOCAL design
//     constants (not in design/config.ts); they scale with TRANSITION_SOFTNESS_BLOCKS.
//
// Surface materials: plains/forest grass over dirt, mountains stone over stone, and any column
// whose surface is above SNOW_CAP_Y gets BLOCKS.snow as its top block (any biome).
//
// ---------------------------------------------------------------------------------------
// TREES
//
// Each chunk column (cx, cz) draws FOREST_TREES_PER_CHUNK candidate positions from
// splitmix32(cyrb128(`${seed}/trees/${cx}/${cz}`)[0]), at least 3 apart (Chebyshev). A
// candidate becomes a tree only if its column is FOREST with a grass top, so interior forest
// chunks get exactly N trees and edge chunks fewer. Canopies reach 2 blocks, so terrainAt for a
// chunk also stamps trees rooted in the 8 neighbouring chunk columns (see terrain.ts).

import { createNoise2D } from "simplex-noise";
import type { NoiseFunction2D } from "simplex-noise";
import { BIOMES } from "../../design/config";
import { cyrb128, rngFromSeed, splitmix32 } from "../core/rng";
import { BLOCKS } from "../world/blocks";

export const BIOME = { PLAINS: 0, FOREST: 1, MOUNTAINS: 2 } as const;
export type BiomeId = (typeof BIOME)[keyof typeof BIOME];

export interface BiomeWeights {
  plains: number;
  forest: number;
  mountains: number;
}

/** Everything terrainAt needs to know about one world column (x, z). */
export interface Column {
  /** Dominant biome (hard thresholds on w; see biomeAt). */
  biome: BiomeId;
  /** World y of the top solid block. */
  height: number;
  /** Block id at y == height (grass, stone or snow). */
  surface: number;
  /** Block id for the 3 layers under the surface (dirt for plains/forest, stone for mountains). */
  subsurface: number;
}

// Band thresholds on w (ADR-0013).
const T_PLAINS_FOREST = -0.33;
const T_FOREST_MOUNTAINS = 0.33;

// L3 heightmap (same numbers as the L3 generator; forest keeps these hills).
const HEIGHT_BASE = 32;
const OCTAVE_DIVISOR = [128, 64, 32] as const; // power-of-two divisors keep x/d exact
const OCTAVE_AMPLITUDE = [24, 12, 6] as const;
const RELIEF_MAX = 42; // 24 + 12 + 6; each noise value is strictly inside (-1, 1)

// Local design constants, scaled by config TRANSITION_SOFTNESS_BLOCKS (see header).
const FOOTHILL_SOFTNESS_MULT = 4;
const SETTLE_SOFTNESS_MULT = 2;

// Lower bound on |grad w| (w per block) when converting w-distance to blocks. Typical |grad w|
// is ~0.0107; this only matters on near-flat spots, where it makes the bands a little narrower
// than their true size (harmless) instead of dividing by ~0.
const GRADIENT_FLOOR = 0.002;

const SNOW = BLOCKS.snow;

/** Lowest / highest possible surface y for ANY seed and biome (integer, inclusive). */
export const SURFACE_Y_MIN = Math.floor(HEIGHT_BASE * Math.min(1, BIOMES.MOUNTAIN_HEIGHT_MULT) - RELIEF_MAX);
export const SURFACE_Y_MAX = Math.floor(HEIGHT_BASE * Math.max(1, BIOMES.MOUNTAIN_HEIGHT_MULT) + RELIEF_MAX);

// ---------------------------------------------------------------------------------------
// Noise per seed (memoised; immutable after construction, so reuse cannot change output).

interface Fields {
  /** The L3 height noise: createNoise2D(rngFromSeed(seed)). Same table terrain.ts burns first. */
  relief: NoiseFunction2D;
  /** The biome weight field: its own stream, second word of cyrb128(seed). */
  weight: NoiseFunction2D;
}

const FIELDS_CACHE_MAX = 4;
const fieldsCache = new Map<string, Fields>();

function fieldsFor(seed: string): Fields {
  const hit = fieldsCache.get(seed);
  if (hit) return hit;
  const made: Fields = {
    relief: createNoise2D(rngFromSeed(seed)),
    weight: createNoise2D(splitmix32(cyrb128(seed)[1])),
  };
  if (fieldsCache.size >= FIELDS_CACHE_MAX) fieldsCache.clear();
  fieldsCache.set(seed, made);
  return made;
}

function requireInts(fn: string, what: string, ...v: number[]): void {
  // Reject NaN / Infinity / fractions instead of silently answering for the wrong cell.
  for (const n of v) {
    if (!Number.isInteger(n)) {
      throw new RangeError(`${fn}: ${what} must be integers, got (${v.join(", ")})`);
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  let t = (x - edge0) / (edge1 - edge0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------
// The band picker and blend.

function weightAt(f: Fields, x: number, z: number): number {
  const s = BIOMES.WEIGHT_NOISE_SCALE;
  return f.weight(x * s, z * s);
}

function biomeFromW(w: number): BiomeId {
  return w < T_PLAINS_FOREST ? BIOME.PLAINS : w < T_FOREST_MOUNTAINS ? BIOME.FOREST : BIOME.MOUNTAINS;
}

interface Band {
  w: number;
  /** Signed distance in blocks to the plains|forest border (positive on the forest side). */
  d1: number;
  /** Signed distance in blocks to the forest|mountains border (positive on the mountain side). */
  d2: number;
}

function bandAt(f: Fields, x: number, z: number): Band {
  const s = BIOMES.WEIGHT_NOISE_SCALE;
  const w = f.weight(x * s, z * s);
  const gx = (f.weight((x + 1) * s, z * s) - f.weight((x - 1) * s, z * s)) / 2;
  const gz = (f.weight(x * s, (z + 1) * s) - f.weight(x * s, (z - 1) * s)) / 2;
  const g = Math.max(Math.sqrt(gx * gx + gz * gz), GRADIENT_FLOOR);
  return { w, d1: (w - T_PLAINS_FOREST) / g, d2: (w - T_FOREST_MOUNTAINS) / g };
}

function weightsOf(b: Band): BiomeWeights {
  const soft = BIOMES.TRANSITION_SOFTNESS_BLOCKS;
  let mountains = smoothstep(-soft, soft, b.d2);
  let plains = 1 - smoothstep(-soft, soft, b.d1);
  let forest = 1 - mountains - plains;
  if (forest < 0) {
    // Only on the very steepest spots with a wide softness, the two bands can touch. Renormalise.
    const sum = mountains + plains;
    mountains /= sum;
    plains /= sum;
    forest = 0;
  }
  return { plains, forest, mountains };
}

/** Which biome owns (x, z). Deterministic from seed + coords; the hard version of the blend. */
export function biomeAt(seed: string, x: number, z: number): BiomeId {
  requireInts("biomeAt", "world coords", x, z);
  return biomeFromW(weightAt(fieldsFor(seed), x, z));
}

/** The ADR-0013 blend weights at (x, z): each in [0,1], summing to 1. */
export function biomeWeightsAt(seed: string, x: number, z: number): BiomeWeights {
  requireInts("biomeWeightsAt", "world coords", x, z);
  return weightsOf(bandAt(fieldsFor(seed), x, z));
}

// ---------------------------------------------------------------------------------------
// The column model.

function columnFrom(f: Fields, x: number, z: number): Column {
  const band = bandAt(f, x, z);
  const weights = weightsOf(band);
  const soft = BIOMES.TRANSITION_SOFTNESS_BLOCKS;

  // Baseline: plains level, rising to plains * MOUNTAIN_HEIGHT_MULT as a foothill ramp.
  const foothill = FOOTHILL_SOFTNESS_MULT * soft;
  const up = smoothstep(-foothill, foothill, band.d2);
  const base = HEIGHT_BASE * (1 + (BIOMES.MOUNTAIN_HEIGHT_MULT - 1) * up);

  // Roughness: blend of the biome roughnesses, pulled to PLAINS_ROUGHNESS at a border and
  // recovering to full over SETTLE blocks.
  const plainsR = BIOMES.PLAINS_ROUGHNESS;
  const mixed = weights.plains * plainsR + (weights.forest + weights.mountains) * 1;
  const edge = Math.min(Math.abs(band.d1), Math.abs(band.d2));
  const settle = smoothstep(0, SETTLE_SOFTNESS_MULT * soft, edge);
  const rough = plainsR * (1 - settle) + mixed * settle;

  // Accumulated octave by octave, left to right, so with rough == 1 and up == 0 (forest away
  // from mountains) the sum is exactly the L3 expression 32 + a1 + a2 + a3.
  let H = base;
  for (let i = 0; i < 3; i++) {
    const d = OCTAVE_DIVISOR[i]!;
    H += rough * (OCTAVE_AMPLITUDE[i]! * f.relief(x / d, z / d));
  }
  const height = Math.floor(H);

  const biome = biomeFromW(band.w);
  const rock = biome === BIOME.MOUNTAINS;
  return {
    biome,
    height,
    surface: height > BIOMES.SNOW_CAP_Y ? SNOW : rock ? BLOCKS.stone : BLOCKS.grass,
    subsurface: rock ? BLOCKS.stone : BLOCKS.dirt,
  };
}

/** Biome, surface height and surface materials for the world column (x, z). */
export function columnAt(seed: string, x: number, z: number): Column {
  requireInts("columnAt", "world coords", x, z);
  return columnFrom(fieldsFor(seed), x, z);
}

// ---------------------------------------------------------------------------------------
// Trees.

export const TREE_TRUNK_MIN = 4;
export const TREE_TRUNK_MAX = 6;
/** Tallest cell of any tree above its ground block: the crown tops out 1 above the top log. */
export const TREE_RISE_MAX = TREE_TRUNK_MAX + 1;
const TREE_SPACING = 3; // minimum Chebyshev distance between trees rooted in one chunk column
const TREE_ATTEMPTS_PER_TREE = 16;

/** A tree rooted at world column (x, z); its first log is at y = baseY + 1. */
export interface TreeSpot {
  x: number;
  z: number;
  /** World y of the ground (grass) block under the trunk. */
  baseY: number;
  /** Number of logs, TREE_TRUNK_MIN..TREE_TRUNK_MAX. */
  trunk: number;
}

/** One block of a tree, relative to the ground block at the trunk (dy >= 1). */
export interface TreeCell {
  dx: number;
  dy: number;
  dz: number;
  block: number;
}

const shapeCache = new Map<number, readonly TreeCell[]>();

/** The blocks of a tree with `trunk` logs. Logs first, then leaves. Same array every call. */
export function treeBlocks(trunk: number): readonly TreeCell[] {
  const hit = shapeCache.get(trunk);
  if (hit) return hit;
  const cells: TreeCell[] = [];
  for (let dy = 1; dy <= trunk; dy++) cells.push({ dx: 0, dy, dz: 0, block: BLOCKS.wood });
  // Two wide layers around the top logs: 5x5 with the corners cut, trunk cell excluded.
  for (const dy of [trunk - 1, trunk]) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        if (dx === 0 && dz === 0) continue;
        cells.push({ dx, dy, dz, block: BLOCKS.leaves });
      }
    }
  }
  // Cap: a plus shape one above the top log.
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    cells.push({ dx, dy: trunk + 1, dz, block: BLOCKS.leaves });
  }
  shapeCache.set(trunk, cells);
  return cells;
}

/** World y of the highest block of the tree. */
export function treeTopY(t: TreeSpot): number {
  return t.baseY + t.trunk + 1;
}

const TREE_CACHE_MAX = 2048;
const treeCache = new Map<string, readonly TreeSpot[]>();

/**
 * Trees rooted in chunk column (cx, cz), i.e. whose trunk x,z lies inside it. Pure function of
 * (seed, cx, cz): the cache below only saves time and can never change the answer.
 */
export function treesInChunk(seed: string, cx: number, cz: number): readonly TreeSpot[] {
  requireInts("treesInChunk", "chunk coords", cx, cz);
  const key = `${seed}\u0000${cx},${cz}`;
  const hit = treeCache.get(key);
  if (hit) return hit;

  const wanted = Math.max(0, Math.floor(BIOMES.FOREST_TREES_PER_CHUNK));
  const rng = splitmix32(cyrb128(`${seed}/trees/${cx}/${cz}`)[0]);
  const f = fieldsFor(seed);
  const placed: Array<[number, number]> = [];
  const spots: TreeSpot[] = [];

  for (let attempt = 0; placed.length < wanted && attempt < wanted * TREE_ATTEMPTS_PER_TREE; attempt++) {
    // Three draws per attempt whether or not it is accepted, so the stream stays aligned.
    const x = cx * 16 + Math.floor(rng() * 16);
    const z = cz * 16 + Math.floor(rng() * 16);
    const trunk = TREE_TRUNK_MIN + Math.floor(rng() * (TREE_TRUNK_MAX - TREE_TRUNK_MIN + 1));
    let clear = true;
    for (const [px, pz] of placed) {
      if (Math.max(Math.abs(px - x), Math.abs(pz - z)) < TREE_SPACING) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    placed.push([x, z]);

    const col = columnFrom(f, x, z);
    if (col.biome === BIOME.FOREST && col.surface === BLOCKS.grass) {
      spots.push({ x, z, baseY: col.height, trunk });
    }
  }

  if (treeCache.size >= TREE_CACHE_MAX) treeCache.clear();
  treeCache.set(key, spots);
  return spots;
}
