import { describe, test, expect } from "vitest";
import { WORLD } from "../../design/config";
import { World } from "../../src/world/World";
import { Chunk, getBlock as chunkGetBlock, setBlock as chunkSetBlock } from "../../src/world/Chunk";
import { toChunkKey } from "../../src/world/types";
import type { PlayerId, BlockChangeIntent } from "../../src/world/types";
import { BLOCKS } from "../../src/world/blocks";
import type { BlockId } from "../../src/world/blocks";

const SIZE = WORLD.CHUNK_SIZE;
const PID = "p1" as PlayerId;

function placeIntent(x: number, y: number, z: number, id: BlockId = BLOCKS.stone): BlockChangeIntent {
  return { playerId: PID, pos: { x, y, z }, blockId: id, reason: "place", timestamp: 0 };
}
function breakIntent(x: number, y: number, z: number): BlockChangeIntent {
  return { playerId: PID, pos: { x, y, z }, blockId: BLOCKS.air, reason: "break", timestamp: 0 };
}

describe("World.applyBlockChange", () => {
  test("place in loaded chunk succeeds, marks chunk dirty, writes voxel", () => {
    const w = new World("seed");
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    w.setChunk(c);
    const res = w.applyBlockChange(placeIntent(5, 6, 7, BLOCKS.stone));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.chunkKey).toBe("0,0,0");
      expect(res.dirtyChunks).toEqual(["0,0,0"]);
    }
    expect(c.dirty).toBe(true);
    expect(chunkGetBlock(c, 5, 6, 7)).toBe(BLOCKS.stone);
  });

  test("place at chunk boundary (lx=0) adds -x neighbor key to dirtyChunks", () => {
    const w = new World("seed");
    w.setChunk(new Chunk({ cx: 0, cy: 0, cz: 0 }));
    const res = w.applyBlockChange(placeIntent(0, 5, 5, BLOCKS.stone));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.dirtyChunks).toContain("0,0,0");
      expect(res.dirtyChunks).toContain(toChunkKey({ cx: -1, cy: 0, cz: 0 }));
    }
  });

  test("place at chunk boundary (lx=SIZE-1) adds +x neighbor key to dirtyChunks", () => {
    const w = new World("seed");
    w.setChunk(new Chunk({ cx: 0, cy: 0, cz: 0 }));
    const res = w.applyBlockChange(placeIntent(SIZE - 1, 5, 5, BLOCKS.stone));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.dirtyChunks).toContain(toChunkKey({ cx: 1, cy: 0, cz: 0 }));
    }
  });

  test("place at a corner adds all three neighbor keys", () => {
    const w = new World("seed");
    w.setChunk(new Chunk({ cx: 2, cy: 3, cz: 4 }));
    const originX = 2 * SIZE, originY = 3 * SIZE, originZ = 4 * SIZE;
    const res = w.applyBlockChange(placeIntent(originX, originY, originZ, BLOCKS.stone));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.chunkKey).toBe("2,3,4");
      expect(res.dirtyChunks).toContain("2,3,4");
      expect(res.dirtyChunks).toContain(toChunkKey({ cx: 1, cy: 3, cz: 4 }));
      expect(res.dirtyChunks).toContain(toChunkKey({ cx: 2, cy: 2, cz: 4 }));
      expect(res.dirtyChunks).toContain(toChunkKey({ cx: 2, cy: 3, cz: 3 }));
    }
  });

  test("place on an occupied cell fails with occupied", () => {
    const w = new World("seed");
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 1, 1, 1, BLOCKS.stone);
    w.setChunk(c);
    const res = w.applyBlockChange(placeIntent(1, 1, 1, BLOCKS.grass));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("occupied");
  });

  test("break on air fails with occupied", () => {
    const w = new World("seed");
    w.setChunk(new Chunk({ cx: 0, cy: 0, cz: 0 }));
    const res = w.applyBlockChange(breakIntent(2, 2, 2));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("occupied");
  });

  test("break on solid clears the voxel and marks dirty", () => {
    const w = new World("seed");
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    chunkSetBlock(c, 2, 2, 2, BLOCKS.stone);
    c.dirty = false;
    w.setChunk(c);
    const res = w.applyBlockChange(breakIntent(2, 2, 2));
    expect(res.ok).toBe(true);
    expect(chunkGetBlock(c, 2, 2, 2)).toBe(BLOCKS.air);
    expect(c.dirty).toBe(true);
  });

  test("mutation in unloaded chunk returns out-of-bounds", () => {
    const w = new World("seed");
    const res = w.applyBlockChange(placeIntent(100, 100, 100, BLOCKS.stone));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("out-of-bounds");
  });

  test("World.getBlock returns air for unloaded chunks", () => {
    const w = new World("seed");
    expect(w.getBlock(0, 0, 0)).toBe(BLOCKS.air);
    expect(w.getBlock(-50, -50, -50)).toBe(BLOCKS.air);
  });

  test("World.getBlock reads from loaded chunks via world coords", () => {
    const w = new World("seed");
    const c = new Chunk({ cx: 1, cy: 0, cz: 0 });
    chunkSetBlock(c, 2, 3, 4, BLOCKS.grass);
    w.setChunk(c);
    expect(w.getBlock(SIZE + 2, 3, 4)).toBe(BLOCKS.grass);
  });
});
