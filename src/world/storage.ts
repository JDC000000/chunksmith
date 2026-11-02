// IDB chunk-delta persistence.
//
// We only ever store chunks the player has EDITED. Procedural chunks regenerate
// from the terrain seed on next load, so a fresh world keeps IDB empty until
// the first break/place. The idb-keyval key format is namespaced with a
// WORLD_VERSION so a future schema change (e.g. palette compression at L5)
// gets a clean migration lane: bump the constant, add a migrator, old deltas
// stay readable until the migrator moves them forward.
//
// No three.js. Compiles for both the main thread and Workers (L3+).

import { del, get, keys, set } from "idb-keyval";
import { Chunk } from "./Chunk";
import type { ChunkCoord, ChunkKey } from "./types";
import { toChunkKey } from "./types";

/** Bump + add a migrator when the on-disk shape changes. */
export const WORLD_VERSION = 1;

const KEY_PREFIX = "chunk:v";

/** Idb-keyval key for a chunk delta. Shape: `chunk:v<ver>:<worldId>:<cx,cy,cz>`. */
function chunkKey(worldId: string, c: ChunkCoord): string {
  return `${KEY_PREFIX}${WORLD_VERSION}:${worldId}:${toChunkKey(c)}`;
}

/** Prefix for scanning this world's chunk keys. */
function worldPrefix(worldId: string): string {
  return `${KEY_PREFIX}${WORLD_VERSION}:${worldId}:`;
}

/** Extract the "cx,cy,cz" tail from a full idb-keyval key, or undefined if the key isn't ours. */
function tailOf(fullKey: string, worldId: string): ChunkKey | undefined {
  const prefix = worldPrefix(worldId);
  if (!fullKey.startsWith(prefix)) return undefined;
  return fullKey.slice(prefix.length);
}

/**
 * Load a chunk's voxel bytes from IDB. Returns undefined if the chunk was never
 * edited (caller falls back to terrainFn).
 */
export async function loadChunk(
  worldId: string,
  c: ChunkCoord,
): Promise<Uint8Array | undefined> {
  const raw = (await get(chunkKey(worldId, c))) as Uint8Array | ArrayBuffer | undefined;
  if (!raw) return undefined;
  // idb-keyval may hand back the original Uint8Array or an ArrayBuffer depending
  // on the underlying implementation; normalize to Uint8Array for callers.
  if (raw instanceof Uint8Array) return raw;
  return new Uint8Array(raw);
}

/**
 * Persist a chunk's full voxel bytes (4096 B for a 16^3 chunk). L5 can swap in
 * palette compression; the key format reserves the version slot for that.
 */
export async function saveChunk(worldId: string, chunk: Chunk): Promise<void> {
  // Copy the bytes so a later in-place mutation can't retroactively edit the
  // persisted version. idb-keyval structured-clones on write anyway, but being
  // explicit about the snapshot makes the contract obvious.
  const bytes = new Uint8Array(chunk.voxels);
  await set(chunkKey(worldId, chunk.coord), bytes);
}

/** Delete a chunk's delta. The chunk reverts to procedural next time it's streamed in. */
export async function clearChunk(worldId: string, c: ChunkCoord): Promise<void> {
  await del(chunkKey(worldId, c));
}

/** List saved chunk tails ("cx,cy,cz") for a world. Order is unspecified. */
export async function listSavedChunks(worldId: string): Promise<ChunkKey[]> {
  const all = (await keys()) as IDBValidKey[];
  const result: ChunkKey[] = [];
  for (const k of all) {
    if (typeof k !== "string") continue;
    const tail = tailOf(k, worldId);
    if (tail) result.push(tail);
  }
  return result;
}

/**
 * Nuke every delta for a world. Returns the number of chunks removed. Danger —
 * caller should gate behind a confirm UI.
 */
export async function clearWorld(worldId: string): Promise<number> {
  const all = (await keys()) as IDBValidKey[];
  const prefix = worldPrefix(worldId);
  let removed = 0;
  for (const k of all) {
    if (typeof k !== "string") continue;
    if (!k.startsWith(prefix)) continue;
    await del(k);
    removed++;
  }
  return removed;
}

/**
 * Debounced, idle-triggered chunk saver.
 *
 * Call `markDirty(chunk)` whenever a chunk is mutated. The persistence instance
 * batches writes until `flush()` is called (manually or by the idle loop) and
 * then persists each pending chunk to IDB. The set is a Map keyed by chunk key
 * so repeated marks for the same coord coalesce; the LATEST byte array wins.
 *
 * Wire `start()` once at boot, and the caller is expected to also call
 * `flush()` from a `beforeunload` listener so an abrupt tab close still saves.
 */
export class ChunkPersistence {
  readonly worldId: string;
  readonly flushIntervalMs: number;

  /** Pending chunks keyed by `toChunkKey(coord)` → latest Chunk reference. */
  private readonly pending: Map<ChunkKey, Chunk> = new Map();

  /** requestIdleCallback / setTimeout handle for the periodic flush loop. */
  private timer: number | ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Tracks an in-flight flush so start()'s loop doesn't double-schedule. */
  private flushing: Promise<ChunkKey[]> | null = null;

  constructor(worldId: string, flushIntervalMs = 5000) {
    this.worldId = worldId;
    this.flushIntervalMs = flushIntervalMs;
  }

  /** Add a chunk to the pending write set. Idempotent per coord. */
  markDirty(chunk: Chunk): void {
    this.pending.set(toChunkKey(chunk.coord), chunk);
  }

  /** Current pending size — handy for debug HUDs. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Snapshot + clear the pending set, write each to IDB, return the keys written. */
  async flush(): Promise<ChunkKey[]> {
    // Serialize concurrent callers: if a flush is in flight, return its promise
    // so markDirty→flush races don't double-write the same bytes.
    if (this.flushing) return this.flushing;

    if (this.pending.size === 0) return [];

    const snapshot: [ChunkKey, Chunk][] = [...this.pending.entries()];
    this.pending.clear();

    this.flushing = (async () => {
      const written: ChunkKey[] = [];
      for (const [key, chunk] of snapshot) {
        await saveChunk(this.worldId, chunk);
        written.push(key);
      }
      return written;
    })();

    try {
      return await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  /**
   * Start the periodic flush loop. Uses requestIdleCallback when available so
   * writes don't contend with the frame budget; falls back to setTimeout in
   * Workers / test envs that don't expose it.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  /** Stop the periodic flush loop. Does NOT drop pending work — call flush() if you need it. */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      // Both branches are safe: setTimeout returns a Timeout obj in node and a
      // number in the browser; requestIdleCallback returns a number.
      const t = this.timer;
      this.timer = null;
      if (typeof t === "number") {
        const g = globalThis as unknown as { cancelIdleCallback?: (h: number) => void };
        if (g.cancelIdleCallback) g.cancelIdleCallback(t);
        else clearTimeout(t);
      } else {
        clearTimeout(t);
      }
    }
  }

  private schedule(): void {
    const g = globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    const run = (): void => {
      // Fire the flush and schedule the next tick regardless of result —
      // persistent IDB errors should log, not stop the pipeline. Errors are
      // intentionally silenced here; add a Sentry hook at integration time.
      void this.flush().catch(() => {});
      if (this.running) this.schedule();
    };
    if (g.requestIdleCallback) {
      this.timer = g.requestIdleCallback(run, { timeout: this.flushIntervalMs });
    } else {
      this.timer = setTimeout(run, this.flushIntervalMs);
    }
  }
}
