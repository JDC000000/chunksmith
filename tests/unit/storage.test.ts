// IDB chunk-delta persistence tests.
// Only EDITED chunks are stored — procedural chunks regenerate from seed.
// The tests use fake-indexeddb (loaded in vitest.setup.ts) so round-trips
// go through real IDB code paths without a browser.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  ChunkPersistence,
  WORLD_VERSION,
  clearChunk,
  clearWorld,
  listSavedChunks,
  loadChunk,
  saveChunk,
} from "../../src/world/storage";
import { Chunk } from "../../src/world/Chunk";
import { toChunkKey, type ChunkKey } from "../../src/world/types";
import { WORLD } from "../../design/config";
import { keys as idbKeys, get as idbGet } from "idb-keyval";

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

// =============================================================================
// Adversarial IDB persistence tests — L3 week 2.
// Each test exercises a failure mode that would break a real player's save:
// mid-flight mutation, concurrent flushes, prefix collision, schema drift, etc.
// =============================================================================
describe("storage: adversarial — snapshot semantics", () => {
  test("saveChunk is a snapshot — mutating chunk.voxels AFTER save does not change on-disk bytes", async () => {
    const chunk = filledChunk(0, 0, 0, 42);
    await saveChunk(worldId, chunk);
    // Mutate the live Chunk — this should NOT affect what's already on disk.
    chunk.voxels[0] = 99;
    chunk.voxels[4095] = 99;
    const bytes = await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 });
    expect(bytes![0]).toBe(42); // original fill byte, not the post-save mutation
    expect(bytes![4095]).toBe(42);
  });

  test("markDirty captures the chunk reference — mutating voxels before flush writes LATEST bytes", async () => {
    // This is the inverse of the saveChunk snapshot test: markDirty holds a
    // reference, so mutations until flush() are included. (Playwright place/break
    // relies on this — the mesh builder may mutate voxels during remesh.)
    const p = new ChunkPersistence(worldId);
    const chunk = filledChunk(0, 0, 0, 1);
    p.markDirty(chunk);
    chunk.voxels[500] = 77; // mutate after mark, before flush
    await p.flush();
    const bytes = await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 });
    expect(bytes![500]).toBe(77);
  });

  test("every persisted chunk is exactly CHUNK_SIZE^3 bytes (no padding, no truncation)", async () => {
    const chunk = filledChunk(1, 2, 3, 5);
    await saveChunk(worldId, chunk);
    const bytes = await loadChunk(worldId, { cx: 1, cy: 2, cz: 3 });
    expect(bytes!.length).toBe(WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE * WORLD.CHUNK_SIZE);
    expect(bytes!.length).toBe(4096);
  });
});

describe("storage: adversarial — schema versioning", () => {
  test("every saved key is namespaced with the current WORLD_VERSION", async () => {
    await saveChunk(worldId, filledChunk(0, 0, 0, 1));
    const all = (await idbKeys()) as IDBValidKey[];
    const ours = all.filter((k) => typeof k === "string" && (k as string).includes(worldId));
    expect(ours.length).toBe(1);
    const key = ours[0] as string;
    // Key shape: chunk:v<WORLD_VERSION>:<worldId>:<cx,cy,cz>
    expect(key.startsWith(`chunk:v${WORLD_VERSION}:${worldId}:`)).toBe(true);
  });

  test("loadChunk under a different WORLD_VERSION returns undefined (schema isolation)", async () => {
    // Simulate the L5 upgrade path: an "old" key with WORLD_VERSION=0 was written
    // by a prior build. The current loader (v=WORLD_VERSION) must NOT return it,
    // otherwise a schema change would silently corrupt the world on upgrade.
    const futureKey = `chunk:v${WORLD_VERSION + 1}:${worldId}:0,0,0`;
    const pastKey = `chunk:v${WORLD_VERSION - 1}:${worldId}:0,0,0`;
    const { set: idbSet } = await import("idb-keyval");
    const bytes = new Uint8Array(4096).fill(123);
    await idbSet(futureKey, bytes);
    await idbSet(pastKey, bytes);
    // Current loader keyed on WORLD_VERSION misses both.
    expect(await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 })).toBeUndefined();
    // And listSavedChunks ignores both too.
    expect(await listSavedChunks(worldId)).toEqual([]);
  });
});

describe("storage: adversarial — worldId isolation", () => {
  test("prefix-collision guard: 'alpha' saves don't appear in 'alpha-plus' listings and vice versa", async () => {
    // Classic bug: naive startsWith(worldId) matches "alpha-plus" when scanning for
    // "alpha". The code uses startsWith(prefix) with a trailing ":" separator, so
    // this is actually safe — but it's exactly the kind of thing that regresses.
    const alpha = `${worldId}-alpha`;
    const alphaPlus = `${worldId}-alpha-plus`;
    try {
      await saveChunk(alpha, filledChunk(0, 0, 0, 1));
      await saveChunk(alphaPlus, filledChunk(0, 0, 0, 2));
      const alphaKeys = await listSavedChunks(alpha);
      const alphaPlusKeys = await listSavedChunks(alphaPlus);
      // Each world sees exactly its own chunk.
      expect(alphaKeys).toEqual([toChunkKey({ cx: 0, cy: 0, cz: 0 })]);
      expect(alphaPlusKeys).toEqual([toChunkKey({ cx: 0, cy: 0, cz: 0 })]);
      // Loads are also isolated.
      expect((await loadChunk(alpha, { cx: 0, cy: 0, cz: 0 }))![0]).toBe(1);
      expect((await loadChunk(alphaPlus, { cx: 0, cy: 0, cz: 0 }))![0]).toBe(2);
    } finally {
      await clearWorld(alpha);
      await clearWorld(alphaPlus);
    }
  });

  test("negative chunk coords round-trip correctly", async () => {
    await saveChunk(worldId, filledChunk(-5, -1, -99, 42));
    const bytes = await loadChunk(worldId, { cx: -5, cy: -1, cz: -99 });
    expect(bytes).toBeDefined();
    expect(bytes![0]).toBe(42);
    expect(await listSavedChunks(worldId)).toEqual([
      toChunkKey({ cx: -5, cy: -1, cz: -99 }),
    ]);
  });
});

describe("storage: adversarial — flush edge cases", () => {
  test("empty flush() returns [] and never writes to IDB", async () => {
    const p = new ChunkPersistence(worldId);
    expect(p.pendingCount()).toBe(0);
    const result = await p.flush();
    expect(result).toEqual([]);
    expect((await listSavedChunks(worldId)).length).toBe(0);
  });

  test("flush after stop() still writes pending chunks (stop() does not drop work)", async () => {
    const p = new ChunkPersistence(worldId);
    p.start();
    p.markDirty(filledChunk(0, 0, 0, 7));
    p.stop();
    // Pending still has 1 chunk; manual flush must still work.
    expect(p.pendingCount()).toBe(1);
    const written = await p.flush();
    expect(written).toEqual([toChunkKey({ cx: 0, cy: 0, cz: 0 })]);
    expect((await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 }))![0]).toBe(7);
  });

  test("concurrent flush() calls return the SAME promise (do not double-write)", async () => {
    // Two near-simultaneous flush() calls while writes are in-flight must share
    // one Promise so the batch is not written twice. Any observable side-effect of
    // the second call is a bug.
    const p = new ChunkPersistence(worldId);
    p.markDirty(filledChunk(0, 0, 0, 1));
    const a = p.flush();
    const b = p.flush();
    // Both callers observe the same completion.
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    // And only one write landed on disk.
    expect((await listSavedChunks(worldId)).length).toBe(1);
  });

  test("pendingCount() tracks adds and resets on successful flush", async () => {
    const p = new ChunkPersistence(worldId);
    expect(p.pendingCount()).toBe(0);
    p.markDirty(filledChunk(0, 0, 0, 1));
    p.markDirty(filledChunk(1, 0, 0, 2));
    p.markDirty(filledChunk(0, 0, 0, 3)); // same coord — coalesces
    expect(p.pendingCount()).toBe(2);
    await p.flush();
    expect(p.pendingCount()).toBe(0);
  });

  test("stress: 100 chunks in a single flush all persist and list correctly", async () => {
    const p = new ChunkPersistence(worldId);
    const expected: ChunkKey[] = [];
    for (let i = 0; i < 100; i++) {
      const c = filledChunk(i, 0, 0, (i % 255) + 1);
      p.markDirty(c);
      expected.push(toChunkKey({ cx: i, cy: 0, cz: 0 }));
    }
    const written = await p.flush();
    expect(written.length).toBe(100);
    // Set-equality: order is not guaranteed.
    expect(new Set(written)).toEqual(new Set(expected));
    const listed = await listSavedChunks(worldId);
    expect(listed.length).toBe(100);
    // Spot-check a mid-row chunk's bytes.
    expect((await loadChunk(worldId, { cx: 42, cy: 0, cz: 0 }))![0]).toBe(43);
  });
});

describe("storage: adversarial — multi-instance", () => {
  test("two ChunkPersistence instances on the same worldId interleave safely; last write wins", async () => {
    // Simulates a tab reopening the same world while a background flush is still
    // settling, or a dev-tools re-exec. Both instances write the same key; whichever
    // flushes last wins, and nothing throws.
    const a = new ChunkPersistence(worldId);
    const b = new ChunkPersistence(worldId);
    const chunkA = filledChunk(0, 0, 0, 1);
    const chunkB = filledChunk(0, 0, 0, 2);
    a.markDirty(chunkA);
    b.markDirty(chunkB);
    await a.flush();
    await b.flush();
    const bytes = await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 });
    expect(bytes![0]).toBe(2); // b was last
  });

  test("clearWorld in one instance drops data another instance was about to flush over", async () => {
    const a = new ChunkPersistence(worldId);
    const b = new ChunkPersistence(worldId);
    a.markDirty(filledChunk(0, 0, 0, 10));
    await a.flush();
    // b nukes the world without going through ChunkPersistence at all.
    const removed = await clearWorld(worldId);
    expect(removed).toBe(1);
    expect(await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 })).toBeUndefined();
    // b now marks the same coord dirty and flushes — write still lands.
    b.markDirty(filledChunk(0, 0, 0, 20));
    await b.flush();
    expect((await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 }))![0]).toBe(20);
  });
});

describe("storage: adversarial — cleanup correctness", () => {
  test("clearWorld on empty IDB returns 0 and does not throw", async () => {
    const removed = await clearWorld(`${worldId}-never-written`);
    expect(removed).toBe(0);
  });

  test("clearChunk on a never-saved coord does not throw and leaves other saves intact", async () => {
    await saveChunk(worldId, filledChunk(0, 0, 0, 1));
    await clearChunk(worldId, { cx: 99, cy: 99, cz: 99 }); // never saved
    expect((await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 }))![0]).toBe(1);
  });

  test("after clearWorld, raw IDB has no keys belonging to this world", async () => {
    await saveChunk(worldId, filledChunk(0, 0, 0, 1));
    await saveChunk(worldId, filledChunk(1, 0, 0, 1));
    await clearWorld(worldId);
    const all = (await idbKeys()) as IDBValidKey[];
    const ours = all.filter((k) => typeof k === "string" && (k as string).includes(`:${worldId}:`));
    expect(ours).toEqual([]);
  });
});

describe("storage: adversarial — corruption resistance", () => {
  test("loadChunk accepts ArrayBuffer-shaped idb values (not just Uint8Array)", async () => {
    // Some idb-keyval backends unwrap TypedArrays to raw ArrayBuffers on read;
    // our loader must normalize both shapes so a browser quirk doesn't break saves.
    const { set: idbSet } = await import("idb-keyval");
    const key = `chunk:v${WORLD_VERSION}:${worldId}:0,0,0`;
    const buf = new ArrayBuffer(4096);
    new Uint8Array(buf).fill(55);
    await idbSet(key, buf);
    const bytes = await loadChunk(worldId, { cx: 0, cy: 0, cz: 0 });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes!.length).toBe(4096);
    expect(bytes![0]).toBe(55);
  });

  test("stored bytes are a defensive copy — mutating the chunk after save, saving again, loading first form stays intact", async () => {
    // The L5 netcode scenario: a chunk is saved, applyBlockChange mutates it,
    // another save fires. The second save must reflect the mutation; the first
    // save's structured-clone copy on disk is already superseded. What we're
    // checking: idb-keyval structured-clones on write (saveChunk ALSO snapshots
    // explicitly), so there is no reference leakage between two writes.
    const chunk = filledChunk(0, 0, 0, 1);
    await saveChunk(worldId, chunk);
    const key = `chunk:v${WORLD_VERSION}:${worldId}:0,0,0`;
    const stored = (await idbGet(key)) as Uint8Array | ArrayBuffer | undefined;
    const storedBytes = stored instanceof Uint8Array ? stored : new Uint8Array(stored!);
    // Mutating the IN-MEMORY chunk must not retroactively edit the IDB-stored bytes.
    chunk.voxels[0] = 99;
    expect(storedBytes[0]).toBe(1);
  });
});
