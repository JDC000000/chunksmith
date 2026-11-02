// Terrain generation. Pure, synchronous, deterministic.
//
// HARD CONTRACT: terrainAt(seed, cx, cy, cz) returns a Uint8Array(4096) that is
// bit-identical for the same arguments on every machine, every run, forever.
//
// Decoupling: this file runs inside Web Workers from L3 on, so it must not see the
// renderer or the main-thread world. No `three`, no `src/world/` imports. The only
// allowed imports are src/core/rng.ts (all randomness) and design/config.ts.
//
// L2 behaviour is "superflat" and uses no randomness, so rng.ts is not imported yet.
// When L3 adds cave/biome noise, derive ALL noise state from the string seed via
// cyrb128 in src/core/rng.ts. Math.random is banned in this directory.

import { WORLD } from "../../design/config";

// Block IDs, hard-coded to stay decoupled from src/world/.
// Source of truth: src/world/blocks.ts (BLOCKS = { air:0, grass:1, dirt:2, stone:3 }).
// Known gotcha, accepted: if blocks.ts renumbers, update these AND the golden hash.
const AIR = 0;
const GRASS = 1;
const STONE = 3;

const S = WORLD.CHUNK_SIZE; // 16, locked by ADR-0002
const CHUNK_VOLUME = S * S * S; // 4096

/**
 * Chunk terrain as a flat block-ID array.
 * Flat index: x + z*16 + y*256 (local coords, each 0..15).
 *
 * L2 superflat: the only grass layer is world y=0. A chunk's local y=0 sits at world
 * y = cy*16, so:
 *   cy < 0   -> all stone
 *   cy === 0 -> local y=0 is grass, local y>=1 is air
 *   cy > 0   -> all air
 *
 * `_seed` is accepted (and will be hashed via cyrb128 from L3) but L2 output does not
 * depend on it. The golden hash in tests/unit/terrain.test.ts therefore does not
 * exercise the seed path; L3 will need its own goldens.
 *
 * Every call returns a fresh, exactly-4096-byte ArrayBuffer-backed array (byteOffset 0)
 * so callers can transfer it to/from a Worker without copying or aliasing.
 */
export function terrainAt(_seed: string, cx: number, cy: number, cz: number): Uint8Array {
  // Reject NaN / Infinity / fractions instead of silently generating a wrong chunk.
  // Throwing is itself deterministic.
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(cz)) {
    throw new RangeError(`terrainAt: chunk coords must be integers, got (${cx}, ${cy}, ${cz})`);
  }

  const out = new Uint8Array(CHUNK_VOLUME); // zero-filled: air

  if (cy < 0) {
    out.fill(STONE);
  } else if (cy === 0) {
    // y=0 layer occupies indices [0, S*S). Everything above stays air.
    out.fill(GRASS, 0, S * S);
  } else {
    out.fill(AIR);
  }

  return out;
}

/**
 * Thin async wrapper so callers can already `await` it; becomes a real Worker
 * round-trip in L3. Resolves to exactly what terrainAt returns.
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
