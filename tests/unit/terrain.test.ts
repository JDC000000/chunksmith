import { describe, test, expect } from "vitest";
import { terrainAt, terrainAtAsync, surfaceHeightAt } from "../../src/gen/terrain";
import { DEV_SEED, E2E_SEED, DEMO_SEED } from "../../src/debug/seeds";

// Block IDs mirrored here on purpose: src/gen is decoupled from src/world, and this
// test pins the raw byte contract. Source of truth: src/world/blocks.ts.
const AIR = 0;
const GRASS = 1;
const DIRT = 2;
const STONE = 3;

const CHUNK_BYTES = 4096;
const S = 16;

/** Flat index, same formula the mesher uses: x + z*16 + y*256. */
const idx = (x: number, y: number, z: number): number => x + z * 16 + y * 256;

/** 32-bit FNV-1a over the whole buffer. Tiny, dependency-free, stable across machines. */
function hashOf(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Count of each block ID in a chunk: [air, grass, dirt, stone]. */
function tally(bytes: Uint8Array): [number, number, number, number] {
  const t: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < bytes.length; i++) t[bytes[i]!]!++;
  return t;
}

// ---------------------------------------------------------------------------------------
// GOLDENS (L3 Day 2). SCHEDULED BREAK: the L2 superflat golden (4286672581) is gone on
// purpose. L3 replaces superflat with multi-octave hills + 3D caves, which changes every
// byte of terrain output. Nothing from L2 (saved worlds, baselines) is expected to survive.
//
// These values were produced by an independent, naive reference implementation (no caching,
// no early-outs) and then matched by src/gen/terrain.ts. From here on they are frozen:
// if one changes, terrain output changed, and every saved world and baseline screenshot is
// invalidated. Do NOT "fix" these numbers without an ADR.
//
// Seed is DEV_SEED === "chunksmith-dev-001" (src/debug/seeds.ts).
// ---------------------------------------------------------------------------------------
const GOLDEN_SEED = "chunksmith-dev-001";
const GOLDEN_HASH_CHUNK_000 = 882683694;
const GOLDEN_HASH_CHUNK_000_FIRST_256 = 3851703075; // local y=0 layer only
const GOLDEN_CHUNKS: ReadonlyArray<{ at: [number, number, number]; hash: number }> = [
  { at: [0, 0, 0], hash: 882683694 }, // fully below the surface here: stone + caves
  { at: [0, 2, 0], hash: 2421898436 }, // surface chunk: air, grass, dirt, stone
  { at: [-3, -5, 7], hash: 2113509279 }, // deep underground, negative x, positive z
];

// Heightmap bound implied by the algorithm: 32 + (24 + 12 + 6) * [-1, 1].
// simplex output is strictly inside [-1, 1], so every surface lies in [-10, 74].
const H_MIN_BOUND = 32 - 42;
const H_MAX_BOUND = 32 + 42;

describe("terrainAt: determinism contract", () => {
  test("golden seed constant matches DEV_SEED", () => {
    expect(GOLDEN_SEED).toBe(DEV_SEED);
  });

  test("same args twice: 4096 bytes, identical first 128 bytes, identical full hash", () => {
    const a = terrainAt(GOLDEN_SEED, 0, 0, 0);
    const b = terrainAt(GOLDEN_SEED, 0, 0, 0);

    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(CHUNK_BYTES);
    expect(b.length).toBe(CHUNK_BYTES);

    expect(Array.from(a.subarray(0, 128))).toEqual(Array.from(b.subarray(0, 128)));
    // First 128 bytes = local y=0, z=0..7. Voxel (0,0,0) is the world origin, where 3D
    // simplex noise is exactly 0 (inside the |n| < 0.08 cave band) so it is carved to air;
    // the rest of that row is solid stone (surface is >= 32 blocks above here).
    expect(Array.from(a.subarray(0, 128))).toEqual([AIR, ...new Array(127).fill(STONE)]);

    expect(hashOf(a)).toBe(hashOf(b));
  });

  test("golden hash is locked in (full chunk and first 256 bytes)", () => {
    const c = terrainAt(GOLDEN_SEED, 0, 0, 0);
    expect(hashOf(c)).toBe(GOLDEN_HASH_CHUNK_000);
    expect(hashOf(c.subarray(0, 256))).toBe(GOLDEN_HASH_CHUNK_000_FIRST_256);
  });

  test.each(GOLDEN_CHUNKS)("golden hash is locked in for chunk $at", ({ at, hash }) => {
    expect(hashOf(terrainAt(GOLDEN_SEED, at[0], at[1], at[2]))).toBe(hash);
  });

  test("same seed + same coords always gives identical bytes (many chunks)", () => {
    const coords: Array<[number, number, number]> = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [3, 0, -7],
      [0, -1, 0], [0, -4, 0], [0, 1, 0], [0, 4, 0], [-5, -2, 9],
      [0, 2, 0], [2, 3, 2], [-7, 2, -7], [0, 10, 0], [0, -5, 0],
    ];
    for (const seed of [DEV_SEED, "whatever", ""]) {
      for (const [cx, cy, cz] of coords) {
        const a = terrainAt(seed, cx, cy, cz);
        const b = terrainAt(seed, cx, cy, cz);
        expect(a.length).toBe(CHUNK_BYTES);
        expect(hashOf(a)).toBe(hashOf(b));
        expect(Array.from(a)).toEqual(Array.from(b));
      }
    }
  });

  test("output does not depend on call history (no state leaks between seeds or chunks)", () => {
    const before = terrainAt(GOLDEN_SEED, 0, 2, 0);
    // Interleave other seeds and coords; any per-seed noise cache must not bleed.
    terrainAt("some-other-seed", 5, -3, 2);
    terrainAt(GOLDEN_SEED, 9, 1, -9);
    terrainAt("", 0, 2, 0);
    terrainAt(DEMO_SEED, 0, 2, 0);
    const after = terrainAt(GOLDEN_SEED, 0, 2, 0);
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  test("each call returns a fresh buffer (mutating one result never leaks into the next)", () => {
    const a = terrainAt(GOLDEN_SEED, 0, 0, 0);
    const before = hashOf(a);
    a.fill(STONE);
    const b = terrainAt(GOLDEN_SEED, 0, 0, 0);
    expect(b).not.toBe(a);
    expect(b.buffer).not.toBe(a.buffer);
    expect(hashOf(b)).toBe(before);
  });

  test("different chunk coords give different bytes (seed(0,0,0) != seed(1,0,0) etc.)", () => {
    const coords: Array<[number, number, number]> = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
      [0, -1, 0], [0, 1, 0], [0, 2, 0], [1, 2, 0], [0, 2, 1], [0, -5, 0], [0, -6, 0],
    ];
    const hashes = coords.map(([cx, cy, cz]) => hashOf(terrainAt(GOLDEN_SEED, cx, cy, cz)));
    expect(new Set(hashes).size).toBe(coords.length);

    const origin = terrainAt(GOLDEN_SEED, 0, 0, 0);
    const east = terrainAt(GOLDEN_SEED, 1, 0, 0);
    expect(Array.from(east)).not.toEqual(Array.from(origin));
  });

  test("3 seeds produce 3 different byte arrays", () => {
    // (0,0,0) is the golden-seed chunk; (0,2,0) is where the surface lives for these seeds.
    for (const [cx, cy, cz] of [[0, 0, 0], [0, 2, 0]] as const) {
      const [a, b, c] = [DEV_SEED, E2E_SEED, DEMO_SEED].map((s) => terrainAt(s, cx, cy, cz));
      expect(Array.from(a!)).not.toEqual(Array.from(b!));
      expect(Array.from(a!)).not.toEqual(Array.from(c!));
      expect(Array.from(b!)).not.toEqual(Array.from(c!));
      expect(new Set([hashOf(a!), hashOf(b!), hashOf(c!)]).size).toBe(3);
    }
  });

  test("seed strings that differ only slightly still diverge", () => {
    const a = terrainAt("chunksmith-demo-v1", 0, 2, 0);
    const b = terrainAt("chunksmith-demo-v2", 0, 2, 0);
    expect(hashOf(a)).not.toBe(hashOf(b));
  });

  test("negative zero coords behave like zero", () => {
    expect(hashOf(terrainAt(GOLDEN_SEED, -0, -0, -0))).toBe(hashOf(terrainAt(GOLDEN_SEED, 0, 0, 0)));
    expect(hashOf(terrainAt(GOLDEN_SEED, -0, 2, -0))).toBe(hashOf(terrainAt(GOLDEN_SEED, 0, 2, 0)));
  });

  test("non-integer or non-finite chunk coords are rejected, not silently mis-generated", () => {
    expect(() => terrainAt(GOLDEN_SEED, 0, NaN, 0)).toThrow(RangeError);
    expect(() => terrainAt(GOLDEN_SEED, 0.5, 0, 0)).toThrow(RangeError);
    expect(() => terrainAt(GOLDEN_SEED, 0, Infinity, 0)).toThrow(RangeError);
  });
});

describe("terrainAt: L3 shape (rolling hills + caves)", () => {
  test("chunk (0,0,0): mixed, not a single block type (air + stone, golden seed)", () => {
    const [air, grass, dirt, stone] = tally(terrainAt(GOLDEN_SEED, 0, 0, 0));
    // World y 0..15 sits fully below the golden seed's surface (>= 32 over this footprint),
    // so it is solid stone with caves carved out. No surface layers here.
    expect(air).toBeGreaterThan(0);
    expect(stone).toBeGreaterThan(0);
    expect(grass).toBe(0);
    expect(dirt).toBe(0);
    expect(air + stone).toBe(CHUNK_BYTES);
  });

  test("chunk (0,0,0) with DEMO_SEED: the surface crosses it, all four block types present", () => {
    // Demo world surface near the origin is y 9..32, so this chunk holds grass and dirt too.
    const t = tally(terrainAt(DEMO_SEED, 0, 0, 0));
    for (const n of t) expect(n).toBeGreaterThan(0);
  });

  test("chunk (0,2,0) golden seed: surface chunk has air, grass, dirt AND stone", () => {
    const t = tally(terrainAt(GOLDEN_SEED, 0, 2, 0));
    for (const n of t) expect(n).toBeGreaterThan(0);
    expect(t[0] + t[1] + t[2] + t[3]).toBe(CHUNK_BYTES);
  });

  test("chunk (0,10,0): high in the sky is all air", () => {
    const c = terrainAt(GOLDEN_SEED, 0, 10, 0);
    expect(c.every((v) => v === AIR)).toBe(true);
  });

  test("every chunk with cy >= 5 is air for any seed (height can never exceed y=74)", () => {
    for (const seed of [DEV_SEED, E2E_SEED, DEMO_SEED, "whatever", ""]) {
      for (const [cx, cz] of [[0, 0], [1, -1], [-4, 6], [9, 9]] as const) {
        for (const cy of [5, 6, 20]) {
          const c = terrainAt(seed, cx, cy, cz);
          expect(c.every((v) => v === AIR), `${seed} (${cx},${cy},${cz})`).toBe(true);
        }
      }
    }
  });

  test("chunk (0,-5,0): deep underground is mostly stone, with SOME cave air carved", () => {
    const [air, grass, dirt, stone] = tally(terrainAt(GOLDEN_SEED, 0, -5, 0));
    expect(grass).toBe(0);
    expect(dirt).toBe(0);
    expect(air).toBeGreaterThan(0); // caves exist
    expect(stone).toBeGreaterThan(CHUNK_BYTES / 2); // but it is mostly rock
    expect(air + stone).toBe(CHUNK_BYTES);
  });

  test("caves exist across many deep chunks, and never turn into grass/dirt", () => {
    let air = 0;
    let total = 0;
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) {
        for (const cy of [-2, -3, -4, -5]) {
          const [a, g, d, s] = tally(terrainAt(GOLDEN_SEED, cx, cy, cz));
          expect(g + d).toBe(0);
          expect(a + s).toBe(CHUNK_BYTES);
          air += a;
          total += CHUNK_BYTES;
        }
      }
    }
    const fraction = air / total;
    expect(fraction).toBeGreaterThan(0.02); // caves are present...
    expect(fraction).toBeLessThan(0.4); // ...but terrain is not Swiss cheese
  });

  test("column structure: air above, one grass, three dirt, then stone/caves (across chunk seams)", () => {
    // Read a world column by stacking chunks cy = 5 .. -3 (covers every possible surface).
    const columnOf = (seed: string, wx: number, wz: number): Uint8Array => {
      const cx = Math.floor(wx / S);
      const cz = Math.floor(wz / S);
      const lx = wx - cx * S;
      const lz = wz - cz * S;
      const out = new Uint8Array(9 * S); // world y = -48 .. 95
      for (let cy = 5; cy >= -3; cy--) {
        const c = terrainAt(seed, cx, cy, cz);
        for (let ly = 0; ly < S; ly++) out[(cy + 3) * S + ly] = c[idx(lx, ly, lz)]!;
      }
      return out;
    };

    const columns: Array<[number, number]> = [
      [0, 0], [15, 15], [16, 16], [-1, -1], [-16, 5], [37, -23], [-100, 100], [3, 200],
    ];
    for (const seed of [DEV_SEED, DEMO_SEED, "whatever"]) {
      for (const [wx, wz] of columns) {
        const col = columnOf(seed, wx, wz);
        const h = surfaceHeightAt(seed, wx, wz);
        const where = `${seed} col (${wx},${wz}) h=${h}`;
        const at = (wy: number): number => col[wy + 48]!;

        for (let wy = 95; wy > h; wy--) expect(at(wy), `${where} y=${wy} should be air`).toBe(AIR);
        expect(at(h), `${where} grass`).toBe(GRASS);
        for (let wy = h - 1; wy >= h - 3; wy--) {
          expect(at(wy), `${where} y=${wy} should be dirt`).toBe(DIRT);
        }
        for (let wy = h - 4; wy >= -48; wy--) {
          const v = at(wy);
          expect(v === STONE || v === AIR, `${where} y=${wy} got ${v}`).toBe(true);
        }
      }
    }
  });

  test("surfaceHeightAt: integer heights inside 32 +/- 42, and rolling (not flat)", () => {
    const seen = new Set<number>();
    let min = Infinity;
    let max = -Infinity;
    for (const seed of [DEV_SEED, E2E_SEED, DEMO_SEED]) {
      for (let z = -512; z <= 512; z += 16) {
        for (let x = -512; x <= 512; x += 16) {
          const h = surfaceHeightAt(seed, x, z);
          expect(Number.isInteger(h)).toBe(true);
          min = Math.min(min, h);
          max = Math.max(max, h);
          seen.add(h);
        }
      }
    }
    expect(min).toBeGreaterThanOrEqual(H_MIN_BOUND);
    expect(max).toBeLessThanOrEqual(H_MAX_BOUND);
    expect(max - min).toBeGreaterThan(40); // real hills, not superflat
    expect(seen.size).toBeGreaterThan(30);
  });

  test("golden seed heightmap over the chunk (0,*,0) footprint is locked at 32..51", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const h = surfaceHeightAt(GOLDEN_SEED, x, z);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    expect([min, max]).toEqual([32, 51]);
  });

  test("surfaceHeightAt is deterministic and rejects non-finite input", () => {
    expect(surfaceHeightAt(GOLDEN_SEED, 7, -9)).toBe(surfaceHeightAt(GOLDEN_SEED, 7, -9));
    expect(() => surfaceHeightAt(GOLDEN_SEED, NaN, 0)).toThrow(RangeError);
    expect(() => surfaceHeightAt(GOLDEN_SEED, 0, 0.5)).toThrow(RangeError);
  });
});

describe("terrainAt: buffer shape", () => {
  test("backing store is a plain ArrayBuffer sized exactly 4096 (transferable to Workers later)", () => {
    for (const [cx, cy, cz] of [[0, 0, 0], [0, 2, 0], [0, 10, 0], [0, -5, 0]] as const) {
      const c = terrainAt(GOLDEN_SEED, cx, cy, cz);
      expect(c.buffer instanceof ArrayBuffer).toBe(true);
      expect(c.buffer.byteLength).toBe(CHUNK_BYTES);
      expect(c.byteOffset).toBe(0);
    }
  });
});

describe("terrainAtAsync", () => {
  test("resolves to the same bytes as terrainAt", async () => {
    const sync = terrainAt(GOLDEN_SEED, 2, 2, -2);
    const async_ = await terrainAtAsync(GOLDEN_SEED, 2, 2, -2);
    expect(async_).toBeInstanceOf(Uint8Array);
    expect(async_.length).toBe(CHUNK_BYTES);
    expect(hashOf(async_)).toBe(hashOf(sync));
  });

  test("rejects (does not throw synchronously) on bad coords", async () => {
    await expect(terrainAtAsync(GOLDEN_SEED, 0.5, 0, 0)).rejects.toBeInstanceOf(RangeError);
  });
});
