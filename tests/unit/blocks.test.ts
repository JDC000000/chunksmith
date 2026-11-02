import { describe, test, expect } from "vitest";
import {
  BLOCKS,
  BLOCK_FACES,
  isSolid,
  isTransparent,
  emission,
  lightAttenuation,
} from "../../src/world/blocks";
import { LIGHTING } from "../../design/config";

describe("blocks registry — L1-L3", () => {
  test("air is slot 0", () => {
    expect(BLOCKS.air).toBe(0);
  });

  test("isSolid returns false for air, true for grass/dirt/stone", () => {
    expect(isSolid(BLOCKS.air)).toBe(false);
    expect(isSolid(BLOCKS.grass)).toBe(true);
    expect(isSolid(BLOCKS.dirt)).toBe(true);
    expect(isSolid(BLOCKS.stone)).toBe(true);
  });

  test("every non-air block has face UVs", () => {
    for (const [name, id] of Object.entries(BLOCKS)) {
      if (id === BLOCKS.air) continue;
      // Cast is OK: we filtered out air explicitly.
      expect(BLOCK_FACES[id as Exclude<typeof id, 0>], `${name} needs faces`).toBeDefined();
    }
  });
});

describe("blocks registry — L4 new blocks", () => {
  // US-L4-13: 5-6 new block types defined with correct properties.
  test("wood=4 is a solid opaque log", () => {
    expect(BLOCKS.wood).toBe(4);
    expect(isSolid(BLOCKS.wood)).toBe(true);
    expect(isTransparent(BLOCKS.wood)).toBe(false);
    expect(emission(BLOCKS.wood)).toBe(0);
    expect(BLOCK_FACES[BLOCKS.wood]).toBeDefined();
  });

  test("leaves=5 is solid but semi-transparent (light passes with +2 attenuation)", () => {
    expect(BLOCKS.leaves).toBe(5);
    // Still solid for collision — a tree you can stand on.
    expect(isSolid(BLOCKS.leaves)).toBe(true);
    // But light passes through.
    expect(isTransparent(BLOCKS.leaves)).toBe(true);
    expect(emission(BLOCKS.leaves)).toBe(0);
    // Light propagates through leaves at an extra 2 blocks of falloff on top of
    // the base per-block falloff — "2 blocks less than air".
    expect(lightAttenuation(BLOCKS.leaves)).toBe(LIGHTING.FALLOFF_PER_BLOCK + 2);
    // Base per-block attenuation for air is the LIGHTING default.
    expect(lightAttenuation(BLOCKS.air)).toBe(LIGHTING.FALLOFF_PER_BLOCK);
  });

  test("torch=6 emits LIGHTING.TORCH_LIGHT_LEVEL, is non-solid and transparent", () => {
    expect(BLOCKS.torch).toBe(6);
    expect(isSolid(BLOCKS.torch)).toBe(false);
    expect(isTransparent(BLOCKS.torch)).toBe(true);
    expect(emission(BLOCKS.torch)).toBe(LIGHTING.TORCH_LIGHT_LEVEL);
  });

  test("water=7 is cosmetic — non-solid, transparent, zero emission", () => {
    expect(BLOCKS.water).toBe(7);
    expect(isSolid(BLOCKS.water)).toBe(false);
    expect(isTransparent(BLOCKS.water)).toBe(true);
    expect(emission(BLOCKS.water)).toBe(0);
  });

  test("sand=8 is a solid opaque block", () => {
    expect(BLOCKS.sand).toBe(8);
    expect(isSolid(BLOCKS.sand)).toBe(true);
    expect(isTransparent(BLOCKS.sand)).toBe(false);
    expect(emission(BLOCKS.sand)).toBe(0);
  });

  test("snow=9 is a solid opaque block", () => {
    expect(BLOCKS.snow).toBe(9);
    expect(isSolid(BLOCKS.snow)).toBe(true);
    expect(isTransparent(BLOCKS.snow)).toBe(false);
    expect(emission(BLOCKS.snow)).toBe(0);
  });

  test("all 10 BLOCKS ids are 0..9 contiguous", () => {
    const ids = Object.values(BLOCKS).sort((a, b) => a - b);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("every non-air block has a BLOCK_FACES entry", () => {
    for (const [name, id] of Object.entries(BLOCKS)) {
      if (id === BLOCKS.air) continue;
      expect(BLOCK_FACES[id as Exclude<typeof id, 0>], `${name} missing faces`).toBeDefined();
    }
  });
});
