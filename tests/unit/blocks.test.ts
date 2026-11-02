import { describe, test, expect } from "vitest";
import { BLOCKS, BLOCK_FACES, isSolid } from "../../src/world/blocks";

describe("blocks registry", () => {
  test("air is slot 0", () => {
    expect(BLOCKS.air).toBe(0);
  });

  test("isSolid returns false for air, true for others", () => {
    expect(isSolid(BLOCKS.air)).toBe(false);
    expect(isSolid(BLOCKS.grass)).toBe(true);
    expect(isSolid(BLOCKS.dirt)).toBe(true);
    expect(isSolid(BLOCKS.stone)).toBe(true);
  });

  test("every non-air block has face UVs", () => {
    for (const [name, id] of Object.entries(BLOCKS)) {
      if (id === BLOCKS.air) continue;
      expect(BLOCK_FACES[id as 1 | 2 | 3], `${name} needs faces`).toBeDefined();
    }
  });
});
