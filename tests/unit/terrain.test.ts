import { describe, test, expect } from "vitest";
import { terrainAt, terrainAtAsync, surfaceHeightAt } from "../../src/gen/terrain";
import {
  BIOME,
  SURFACE_Y_MAX,
  SURFACE_Y_MIN,
  TREE_RISE_MAX,
  columnAt,
} from "../../src/gen/biomes";
import { BLOCKS } from "../../src/world/blocks";
import { BIOMES } from "../../design/config";
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

/** Count of each block ID in a chunk, indexed by id: [air, grass, dirt, stone, ...L4 blocks]. */
function tally(bytes: Uint8Array): number[] {
  const t: number[] = new Array(16).fill(0);
  for (let i = 0; i < bytes.length; i++) t[bytes[i]!]!++;
  return t;
}

/** The four L3 block types (air, grass, dirt, stone) from a tally. */
const basics = (t: number[]): number[] => t.slice(0, 4);

// ---------------------------------------------------------------------------------------
// GOLDENS (L3 Day 2, extended L4 Day 2). SCHEDULED BREAK #1: the L2 superflat golden
// (4286672581) is gone on purpose. L3 replaced superflat with multi-octave hills + 3D caves.
//
// The L3 values below were produced by an independent, naive reference implementation (no
// caching, no early-outs) and then matched by src/gen/terrain.ts. From here on they are frozen:
// if one changes, terrain output changed, and every saved world and baseline screenshot is
// invalidated. Do NOT "fix" these numbers without an ADR.
//
// SCHEDULED BREAK #2 (L4 Day 2, PRD-L4 risk #9): the biome layer rewrites every SURFACE chunk,
// so the surface-chunk goldens moved (e.g. DEV chunk (0,2,0): 2421898436 -> 426455564).
// The UNDERGROUND goldens did NOT move, and that is the point: chunk (0,0,0) (y 0..15) and
// chunk (-3,-5,7) lie wholly below the surface, so they hold only stone and caves, and caves
// are byte-identical to L3. That is proof the cave noise tables and draw order survived the
// biome layer untouched. Chunk (0,0,0) therefore keeps its L3 hash 882683694.
// The L4 goldens (GOLDEN_L4_*) are regression locks produced by this implementation, not by an
// independent reference; they are backed by the property tests in biomes.test.ts and
// trees.test.ts (materials, snow cap, tree cells, border smoothness).
//
// Seed is DEV_SEED === "chunksmith-dev-001" (src/debug/seeds.ts).
// ---------------------------------------------------------------------------------------
const GOLDEN_SEED = "chunksmith-dev-001";
const GOLDEN_HASH_CHUNK_000 = 882683694; // unchanged since L3: underground, caves only
const GOLDEN_HASH_CHUNK_000_FIRST_256 = 3851703075; // local y=0 layer only; unchanged since L3
const GOLDEN_CHUNKS: ReadonlyArray<{ at: [number, number, number]; hash: number }> = [
  { at: [0, 0, 0], hash: 882683694 }, // fully below the surface here: stone + caves (unchanged since L3)
  { at: [0, 2, 0], hash: 426455564 }, // surface chunk: air, grass, dirt, stone (L4; was 2421898436)
  { at: [-3, -5, 7], hash: 2113509279 }, // deep underground, negative x, positive z (unchanged since L3)
];

// L4 surface goldens, DEV_SEED. One chunk per surface kind the biome layer can produce.
const GOLDEN_L4_CHUNKS: ReadonlyArray<{ kind: string; at: [number, number, number]; hash: number }> = [
  { kind: "forest with trees", at: [0, 3, 0], hash: 2246951090 },
  { kind: "plains", at: [-2, 1, -2], hash: 972831147 },
  { kind: "mountain rock, trees overhanging from the forest next door", at: [-1, 3, 1], hash: 1710380542 },
  { kind: "mountain snow cap", at: [-1, 4, 2], hash: 2116931909 },
];
// FNV-1a fold of the per-chunk hashes over cx,cz in -2..2 and cy in -1..7 (225 chunks): one
// number that moves if ANY surface, tree, snow or seam detail in the neighbourhood moves.
const GOLDEN_L4_REGION_HASH = 1059465308;

// Height bounds implied by the algorithm. L3: 32 + (24 + 12 + 6) * [-1, 1] = [-10, 74]. L4: the
// mountain baseline rises to 32 * MOUNTAIN_HEIGHT_MULT = 76.8, so surfaces lie in [-10, 118],
// and a tree adds up to TREE_RISE_MAX more. Re-derived here from config, not from biomes.ts.
const H_MIN_BOUND = 32 - 42;
const H_MAX_BOUND = Math.floor(32 * BIOMES.MOUNTAIN_HEIGHT_MULT + 42);

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

  test.each(GOLDEN_L4_CHUNKS)("L4 golden hash is locked in: $kind $at", ({ at, hash }) => {
    expect(hashOf(terrainAt(GOLDEN_SEED, at[0], at[1], at[2]))).toBe(hash);
  });

  test("L4 golden region hash (225 chunks around the origin) is locked in", () => {
    let acc = 0x811c9dc5;
    for (let cz = -2; cz <= 2; cz++) {
      for (let cx = -2; cx <= 2; cx++) {
        for (let cy = -1; cy <= 7; cy++) {
          acc ^= hashOf(terrainAt(GOLDEN_SEED, cx, cy, cz));
          acc = Math.imul(acc, 0x01000193);
        }
      }
    }
    expect(acc >>> 0).toBe(GOLDEN_L4_REGION_HASH);
  });

  test("block ids the generator writes match the registry (tripwire for a renumber)", () => {
    // If voxel-engine-dev renumbers blocks.ts, every L4 golden above moves. Fail here first,
    // with a readable message, instead of as an opaque hash diff.
    expect([BLOCKS.air, BLOCKS.grass, BLOCKS.dirt, BLOCKS.stone]).toEqual([AIR, GRASS, DIRT, STONE]);
    expect([BLOCKS.wood, BLOCKS.leaves, BLOCKS.snow]).toEqual([4, 5, 9]);
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

  test("DEMO_SEED: the chunk holding the surface at the origin has all four basic block types", () => {
    // L3 had the DEMO surface inside chunk (0,0,0). With L4 the origin sits on the foothill
    // ramp (h = 41 or 45), so the surface chunk is cy = 2. Pick it from the column itself.
    const h = surfaceHeightAt(DEMO_SEED, 8, 8);
    const t = tally(terrainAt(DEMO_SEED, 0, Math.floor(h / S), 0));
    for (const n of basics(t)) expect(n).toBeGreaterThan(0);
  });

  test("chunk (0,2,0) golden seed: surface chunk has air, grass, dirt AND stone", () => {
    const t = tally(terrainAt(GOLDEN_SEED, 0, 2, 0));
    for (const n of basics(t)) expect(n).toBeGreaterThan(0);
    expect(t.reduce((a, b) => a + b, 0)).toBe(CHUNK_BYTES);
  });

  test("chunk (0,10,0): high in the sky is all air", () => {
    const c = terrainAt(GOLDEN_SEED, 0, 10, 0);
    expect(c.every((v) => v === AIR)).toBe(true);
  });

  test("every chunk above the highest possible surface + tree is air, for any seed", () => {
    // Highest surface 118 (mountain baseline 76.8 + relief 42) + tallest tree 7 = 125 -> cy 7 is
    // the last chunk that can hold anything; cy >= 8 must be all air.
    const firstAirCy = Math.floor((H_MAX_BOUND + TREE_RISE_MAX) / S) + 1;
    expect(firstAirCy).toBe(8);
    for (const seed of [DEV_SEED, E2E_SEED, DEMO_SEED, "whatever", ""]) {
      for (const [cx, cz] of [[0, 0], [1, -1], [-4, 6], [9, 9]] as const) {
        for (const cy of [firstAirCy, firstAirCy + 1, 20]) {
          const c = terrainAt(seed, cx, cy, cz);
          expect(c.every((v) => v === AIR), `${seed} (${cx},${cy},${cz})`).toBe(true);
        }
      }
    }
  });

  test("mountains really do reach the upper chunks (the bound above is not vacuous)", () => {
    let solidAtCy6 = 0;
    for (let cz = -20; cz <= 20; cz += 2) {
      for (let cx = -20; cx <= 20; cx += 2) {
        if (terrainAt(DEV_SEED, cx, 6, cz).some((v) => v !== AIR)) solidAtCy6++;
      }
    }
    expect(solidAtCy6).toBeGreaterThan(0);
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

  test("column structure: air (or tree) above, the biome's top block, three sub-layers, then stone/caves (across chunk seams)", () => {
    // Read a world column by stacking chunks from the sky down to cy = -3 (world y = -48..).
    const TOP_CY = Math.floor((H_MAX_BOUND + TREE_RISE_MAX) / S); // 7
    const BOT_CY = -3;
    const columnOf = (seed: string, wx: number, wz: number): Uint8Array => {
      const cx = Math.floor(wx / S);
      const cz = Math.floor(wz / S);
      const lx = wx - cx * S;
      const lz = wz - cz * S;
      const out = new Uint8Array((TOP_CY - BOT_CY + 1) * S);
      for (let cy = TOP_CY; cy >= BOT_CY; cy--) {
        const c = terrainAt(seed, cx, cy, cz);
        for (let ly = 0; ly < S; ly++) out[(cy - BOT_CY) * S + ly] = c[idx(lx, ly, lz)]!;
      }
      return out;
    };
    const at = (col: Uint8Array, wy: number): number => col[wy - BOT_CY * S]!;

    // Fixed columns, plus the first column of each surface kind found by scanning (so the
    // mountain, snow and forest layouts are all covered for every seed).
    const kindOf = (seed: string, x: number, z: number): string => {
      const c = columnAt(seed, x, z);
      return c.surface === BLOCKS.snow ? "snow"
        : c.biome === BIOME.PLAINS ? "plains"
        : c.biome === BIOME.FOREST ? "forest"
        : "mountains";
    };
    const fixed: Array<[number, number]> = [
      [0, 0], [15, 15], [16, 16], [-1, -1], [-16, 5], [37, -23], [-100, 100], [3, 200],
    ];
    for (const seed of [DEV_SEED, DEMO_SEED, "whatever"]) {
      const columns = [...fixed];
      const want = new Set(["plains", "forest", "mountains", "snow"]);
      for (let z = -600; z <= 600 && want.size; z += 5) {
        for (let x = -600; x <= 600 && want.size; x += 5) {
          if (want.delete(kindOf(seed, x, z))) columns.push([x, z]);
        }
      }
      expect(want.size, `${seed}: missing kinds ${[...want]}`).toBe(0);

      for (const [wx, wz] of columns) {
        const col = columnOf(seed, wx, wz);
        const c = columnAt(seed, wx, wz);
        const h = surfaceHeightAt(seed, wx, wz);
        expect(h).toBe(c.height);
        const where = `${seed} col (${wx},${wz}) h=${h} ${kindOf(seed, wx, wz)}`;

        for (let wy = TOP_CY * S + S - 1; wy > h; wy--) {
          const v = at(col, wy);
          if (c.biome === BIOME.FOREST) {
            // A tree may stand here: logs and leaves are the only things allowed above ground.
            expect(v === AIR || v === BLOCKS.wood || v === BLOCKS.leaves, `${where} y=${wy} got ${v}`).toBe(true);
          } else {
            expect(v, `${where} y=${wy} should be air`).toBe(AIR);
          }
        }
        expect(at(col, h), `${where} top block`).toBe(c.surface);
        for (let wy = h - 1; wy >= h - 3; wy--) {
          expect(at(col, wy), `${where} y=${wy} should be ${c.subsurface}`).toBe(c.subsurface);
        }
        for (let wy = h - 4; wy >= BOT_CY * S; wy--) {
          const v = at(col, wy);
          expect(v === STONE || v === AIR, `${where} y=${wy} got ${v}`).toBe(true);
        }
      }
    }
  });

  test("surfaceHeightAt: integer heights inside the L4 bounds, and rolling (not flat)", () => {
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
    expect([SURFACE_Y_MIN, SURFACE_Y_MAX]).toEqual([H_MIN_BOUND, H_MAX_BOUND]); // module bounds agree with config
    expect(max - min).toBeGreaterThan(40); // real hills, not superflat
    expect(seen.size).toBeGreaterThan(30);
  });

  test("golden seed heightmap over the chunk (0,*,0) footprint is locked at 41..59", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const h = surfaceHeightAt(GOLDEN_SEED, x, z);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
    expect([min, max]).toEqual([41, 59]); // L3 was [32, 51]; +9 foothill lift at the origin
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
