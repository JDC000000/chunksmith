import { describe, test, expect } from "vitest";
import { terrainAt, terrainAtAsync } from "../../src/gen/terrain";
import { DEV_SEED } from "../../src/debug/seeds";

// Block IDs mirrored here on purpose: src/gen is decoupled from src/world, and this
// test pins the raw byte contract. Source of truth: src/world/blocks.ts.
const AIR = 0;
const GRASS = 1;
const STONE = 3;

const CHUNK_BYTES = 4096;

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

// GOLDEN: FNV-1a(terrainAt("chunksmith-dev-001", 0, 0, 0)) under L2 superflat rules.
// Seed is DEV_SEED === "chunksmith-dev-001" (src/debug/seeds.ts).
// If this changes, terrain output changed: every saved world and baseline screenshot
// is invalidated. Do NOT "fix" this number without an ADR.
const GOLDEN_SEED = "chunksmith-dev-001";
const GOLDEN_HASH_CHUNK_000 = 4286672581;

describe("terrainAt: determinism contract", () => {
  test("golden seed constant matches DEV_SEED", () => {
    expect(GOLDEN_SEED).toBe(DEV_SEED);
  });

  test("same args twice: 4096 bytes, same first 128 bytes, same full hash", () => {
    const a = terrainAt(GOLDEN_SEED, 0, 0, 0);
    const b = terrainAt(GOLDEN_SEED, 0, 0, 0);

    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(CHUNK_BYTES);
    expect(b.length).toBe(CHUNK_BYTES);

    expect(Array.from(a.subarray(0, 128))).toEqual(Array.from(b.subarray(0, 128)));
    // First 128 bytes = local y=0, z=0..7, x=0..15: the grass layer in the superflat world.
    expect(Array.from(a.subarray(0, 128))).toEqual(new Array(128).fill(GRASS));

    expect(hashOf(a)).toBe(hashOf(b));
  });

  test("golden hash is locked in", () => {
    expect(hashOf(terrainAt(GOLDEN_SEED, 0, 0, 0))).toBe(GOLDEN_HASH_CHUNK_000);
  });

  test("same seed + same coords always gives identical bytes (many chunks)", () => {
    const coords: Array<[number, number, number]> = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [3, 0, -7],
      [0, -1, 0], [0, -4, 0], [0, 1, 0], [0, 4, 0], [-5, -2, 9],
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

  test("each call returns a fresh buffer (mutating one result never leaks into the next)", () => {
    const a = terrainAt(GOLDEN_SEED, 0, 0, 0);
    const before = hashOf(a);
    a.fill(STONE);
    const b = terrainAt(GOLDEN_SEED, 0, 0, 0);
    expect(b).not.toBe(a);
    expect(b.buffer).not.toBe(a.buffer);
    expect(hashOf(b)).toBe(before);
  });
});

describe("terrainAt: superflat shape (L2)", () => {
  test("chunk (0,0,0): grass at local y=0, air above", () => {
    const c = terrainAt("whatever", 0, 0, 0);
    expect(c[idx(0, 0, 0)]).toBe(GRASS);
    expect(c[idx(0, 1, 0)]).toBe(AIR);
    expect(c[idx(5, 0, 5)]).toBe(GRASS);
  });

  test("chunk (0,0,0): exactly one grass layer of 256 blocks, everything else air", () => {
    const c = terrainAt("whatever", 0, 0, 0);
    let grass = 0;
    let air = 0;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const v = c[idx(x, y, z)];
          if (y === 0) expect(v).toBe(GRASS);
          else expect(v).toBe(AIR);
          if (v === GRASS) grass++;
          if (v === AIR) air++;
        }
      }
    }
    expect(grass).toBe(256);
    expect(air).toBe(4096 - 256);
  });

  test("chunk (0,-1,0): underground is stone", () => {
    const c = terrainAt("whatever", 0, -1, 0);
    expect(c[idx(0, 15, 0)]).toBe(STONE);
    expect(c.every((v) => v === STONE)).toBe(true);
  });

  test("chunk (0,1,0): sky is air", () => {
    const c = terrainAt("whatever", 0, 1, 0);
    expect(c[idx(0, 0, 0)]).toBe(AIR);
    expect(c.every((v) => v === AIR)).toBe(true);
  });

  test("horizontal position does not change the shape (superflat is infinite in x/z)", () => {
    const origin = hashOf(terrainAt("whatever", 0, 0, 0));
    expect(hashOf(terrainAt("whatever", 7, 0, -3))).toBe(origin);
    expect(hashOf(terrainAt("whatever", -100, 0, 100))).toBe(origin);
  });

  test("negative zero coords behave like zero", () => {
    expect(hashOf(terrainAt("whatever", -0, -0, -0))).toBe(hashOf(terrainAt("whatever", 0, 0, 0)));
  });

  test("non-integer or non-finite chunk coords are rejected, not silently mis-generated", () => {
    expect(() => terrainAt("whatever", 0, NaN, 0)).toThrow(RangeError);
    expect(() => terrainAt("whatever", 0.5, 0, 0)).toThrow(RangeError);
    expect(() => terrainAt("whatever", 0, Infinity, 0)).toThrow(RangeError);
  });
});

describe("terrainAt: buffer shape", () => {
  test("backing store is a plain ArrayBuffer sized exactly 4096 (transferable to Workers later)", () => {
    const c = terrainAt("whatever", 0, 0, 0);
    expect(c.buffer instanceof ArrayBuffer).toBe(true);
    expect(c.buffer.byteLength).toBe(CHUNK_BYTES);
    expect(c.byteOffset).toBe(0);
  });
});

describe("terrainAtAsync", () => {
  test("resolves to the same bytes as terrainAt", async () => {
    const sync = terrainAt(GOLDEN_SEED, 2, 0, -2);
    const async_ = await terrainAtAsync(GOLDEN_SEED, 2, 0, -2);
    expect(async_).toBeInstanceOf(Uint8Array);
    expect(async_.length).toBe(CHUNK_BYTES);
    expect(hashOf(async_)).toBe(hashOf(sync));
  });
});
