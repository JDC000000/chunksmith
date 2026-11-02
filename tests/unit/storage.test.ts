// IDB chunk-delta persistence tests.
// Only EDITED chunks are stored — procedural chunks regenerate from seed.
// The tests use fake-indexeddb (loaded in vitest.setup.ts) so round-trips
// go through real IDB code paths without a browser.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  ChunkPersistence,
  clearChunk,
  clearWorld,
  listSavedChunks,
  loadChunk,
  saveChunk,
} from "../../src/world/storage";
import { Chunk } from "../../src/world/Chunk";
import { toChunkKey } from "../../src/world/types";

/** Each test gets its own worldId to avoid cross-test interference. */
let worldId: string;
let seq = 0;
beforeEach(() => {
  seq++;
  worldId = `test-world-${Date.now()}-${seq}`;
});
afterEach(async () => {
  // Belt-and-suspenders cleanup; each test uses a unique worldId already.
  await clearWorld(worldId);
});

function filledChunk(cx: number, cy: number, cz: number, fillByte: number): Chunk {
  const chunk = new Chunk({ cx, cy, cz });
  chunk.voxels.fill(fillByte);
  return chunk;
}

describe("storage: save/load round-trip", () => {
  test("saveChunk then loadChunk returns the same bytes", async () => {
    const chunk = filledChunk(0, 0, 0, 7);
    chunk.voxels[0] = 1;
    chunk.voxels[123] = 2;
    chunk.voxels[4095] = 3;

    await saveChunk(worldId, chunk);
    const bytes = await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 });
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBe(16 * 16 * 16);
    expect(bytes![0]).toBe(1);
    expect(bytes![123]).toBe(2);
    expect(bytes![4095]).toBe(3);
    expect(bytes![500]).toBe(7); // untouched fill byte
  });

  test("loadChunk returns undefined for a never-saved coord", async () => {
    const bytes = await loadChunk(worldId, { cx: 99, cy: 99, cz: 99 });
    expect(bytes).toBeUndefined();
  });

  test("saveChunk overwrites prior bytes for the same coord", async () => {
    await saveChunk(worldId, filledChunk(1, 2, 3, 10));
    await saveChunk(worldId, filledChunk(1, 2, 3, 20));
    const bytes = await loadChunk(worldId, { cx: 1, cy: 2, cz: 3 });
    expect(bytes).toBeDefined();
    expect(bytes![0]).toBe(20);
    expect(bytes![4095]).toBe(20);
  });

  test("clearChunk removes a saved delta", async () => {
    await saveChunk(worldId, filledChunk(5, 5, 5, 1));
    expect(await loadChunk(worldId, { cx: 5, cy: 5, cz: 5 })).toBeDefined();
    await clearChunk(worldId, { cx: 5, cy: 5, cz: 5 });
    expect(await loadChunk(worldId, { cx: 5, cy: 5, cz: 5 })).toBeUndefined();
  });

  test("listSavedChunks returns the toChunkKey() for each saved chunk, ONLY this world", async () => {
    const other = `${worldId}-other`;
    try {
      await saveChunk(worldId, filledChunk(0, 0, 0, 1));
      await saveChunk(worldId, filledChunk(1, 0, 0, 1));
      await saveChunk(worldId, filledChunk(0, 0, 1, 1));
      await saveChunk(other, filledChunk(42, 42, 42, 1));

      const keys = await listSavedChunks(worldId);
      expect(keys.sort()).toEqual(
        [toChunkKey({ cx: 0, cy: 0, cz: 0 }), toChunkKey({ cx: 1, cy: 0, cz: 0 }), toChunkKey({ cx: 0, cy: 0, cz: 1 })].sort(),
      );
      // The other world's chunk is NOT in this world's listing.
      expect(keys).not.toContain(toChunkKey({ cx: 42, cy: 42, cz: 42 }));
    } finally {
      await clearWorld(other);
    }
  });

  test("clearWorld returns the count and removes every chunk for that world", async () => {
    await saveChunk(worldId, filledChunk(0, 0, 0, 1));
    await saveChunk(worldId, filledChunk(1, 0, 0, 1));
    const n = await clearWorld(worldId);
    expect(n).toBe(2);
    expect((await listSavedChunks(worldId)).length).toBe(0);
  });
});

describe("ChunkPersistence: debounced flush", () => {
  test("markDirty + flush persists every pending chunk and clears the set", async () => {
    const p = new ChunkPersistence(worldId);
    const a = filledChunk(0, 0, 0, 11);
    const b = filledChunk(1, 0, 0, 22);
    const c = filledChunk(0, 0, 1, 33);
    p.markDirty(a); p.markDirty(b); p.markDirty(c);

    const saved = await p.flush();
    expect(saved.sort()).toEqual([
      toChunkKey({ cx: 0, cy: 0, cz: 0 }),
      toChunkKey({ cx: 0, cy: 0, cz: 1 }),
      toChunkKey({ cx: 1, cy: 0, cz: 0 }),
    ].sort());

    // A follow-up flush is a no-op — pending was cleared.
    expect(await p.flush()).toEqual([]);

    // And every chunk's bytes are on disk.
    expect((await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 }))![0]).toBe(11);
    expect((await loadChunk(worldId, { cx: 1, cy: 0, cz: 0 }))![0]).toBe(22);
    expect((await loadChunk(worldId, { cx: 0, cy: 0, cz: 1 }))![0]).toBe(33);
  });

  test("markDirty twice for the same chunk coalesces into one write", async () => {
    const p = new ChunkPersistence(worldId);
    const chunk = filledChunk(2, 2, 2, 7);
    p.markDirty(chunk);
    chunk.voxels[0] = 99;
    p.markDirty(chunk); // same coord — set keeps a single entry
    const saved = await p.flush();
    expect(saved).toEqual([toChunkKey({ cx: 2, cy: 2, cz: 2 })]);
    // The latest bytes are what's persisted (the mutation was in-place).
    expect((await loadChunk(worldId, { cx: 2, cy: 2, cz: 2 }))![0]).toBe(99);
  });
});
