import { describe, test, expect } from "vitest";
import { WORLD } from "../../design/config";
import {
  Chunk,
  chunkIndex,
  getBlock,
  setBlock,
  inBounds,
} from "../../src/world/Chunk";
import {
  toChunkKey,
  parseChunkKey,
  worldToChunk,
} from "../../src/world/types";
import { BLOCKS } from "../../src/world/blocks";

const SIZE = WORLD.CHUNK_SIZE;

describe("chunk data model", () => {
  test("chunkIndex formula matches x + z*SIZE + y*SIZE*SIZE for every voxel", () => {
    const seen = new Set<number>();
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < SIZE; z++) {
        for (let x = 0; x < SIZE; x++) {
          const i = chunkIndex(x, y, z);
          expect(i).toBe(x + z * SIZE + y * SIZE * SIZE);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(SIZE * SIZE * SIZE);
          seen.add(i);
        }
      }
    }
    // Every index from 0..SIZE^3-1 was hit exactly once.
    expect(seen.size).toBe(SIZE * SIZE * SIZE);
  });

  test("fresh chunk voxels is a Uint8Array of CHUNK_SIZE^3 bytes backed by ArrayBuffer", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    expect(c.voxels).toBeInstanceOf(Uint8Array);
    expect(c.voxels.length).toBe(SIZE * SIZE * SIZE);
    expect(c.voxels.length).toBe(4096);
    // Transferable requirement for L3 worker handoff.
    expect(c.voxels.buffer).toBeInstanceOf(ArrayBuffer);
  });

  test("new chunk starts entirely air and not dirty", () => {
    const c = new Chunk({ cx: 1, cy: 2, cz: 3 });
    expect(c.dirty).toBe(false);
    for (let i = 0; i < c.voxels.length; i++) {
      expect(c.voxels[i]).toBe(BLOCKS.air);
    }
  });

  test("getBlock/setBlock round-trip and mark dirty", () => {
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    setBlock(c, 3, 4, 5, BLOCKS.stone);
    expect(getBlock(c, 3, 4, 5)).toBe(BLOCKS.stone);
    expect(c.dirty).toBe(true);
    setBlock(c, 15, 15, 15, BLOCKS.grass);
    expect(getBlock(c, 15, 15, 15)).toBe(BLOCKS.grass);
    expect(getBlock(c, 0, 0, 0)).toBe(BLOCKS.air);
  });

  test("inBounds rejects negatives and >= SIZE", () => {
    expect(inBounds(0, 0, 0)).toBe(true);
    expect(inBounds(SIZE - 1, SIZE - 1, SIZE - 1)).toBe(true);
    expect(inBounds(-1, 0, 0)).toBe(false);
    expect(inBounds(0, -1, 0)).toBe(false);
    expect(inBounds(0, 0, -1)).toBe(false);
    expect(inBounds(SIZE, 0, 0)).toBe(false);
    expect(inBounds(0, SIZE, 0)).toBe(false);
    expect(inBounds(0, 0, SIZE)).toBe(false);
  });

  test("toChunkKey/parseChunkKey round-trip including negatives", () => {
    const coords = [
      { cx: 0, cy: 0, cz: 0 },
      { cx: 1, cy: -2, cz: 3 },
      { cx: -7, cy: 0, cz: -42 },
    ];
    for (const c of coords) {
      const k = toChunkKey(c);
      expect(parseChunkKey(k)).toEqual(c);
    }
  });

  test("worldToChunk floors into chunks and wraps negatives", () => {
    const a = worldToChunk({ x: 0, y: 0, z: 0 }, SIZE);
    expect(a.chunk).toEqual({ cx: 0, cy: 0, cz: 0 });
    expect(a.local).toEqual({ x: 0, y: 0, z: 0 });

    const b = worldToChunk({ x: SIZE, y: SIZE, z: SIZE }, SIZE);
    expect(b.chunk).toEqual({ cx: 1, cy: 1, cz: 1 });
    expect(b.local).toEqual({ x: 0, y: 0, z: 0 });

    const c = worldToChunk({ x: -1, y: -1, z: -1 }, SIZE);
    expect(c.chunk).toEqual({ cx: -1, cy: -1, cz: -1 });
    expect(c.local).toEqual({ x: SIZE - 1, y: SIZE - 1, z: SIZE - 1 });

    const d = worldToChunk({ x: 17, y: 5, z: -17 }, SIZE);
    expect(d.chunk).toEqual({ cx: 1, cy: 0, cz: -2 });
    expect(d.local).toEqual({ x: 1, y: 5, z: SIZE - 1 });
  });
});
