// IDB chunk-delta persistence.
//
// We only ever store chunks the player has EDITED. Procedural chunks regenerate
// from the terrain seed on next load, so a fresh world keeps IDB empty until
// the first break/place. The idb-keyval key format is namespaced with a
// WORLD_VERSION so a future schema change gets a clean migration lane: bump
// the constant, add a migrator, old deltas stay readable until the migrator
// moves them forward.
//
// L4 bumps WORLD_VERSION to 2. v1 keys stored only `voxels` (4096 B). v2 keys
// store `voxels || light` as a single 8192-byte buffer (see ADR-0014). The
// loader reads v2 first; if a v2 key is missing the lane falls back to v1,
// returning the voxels and treating light as all-zero so the lighting system
// re-propagates on next step. Drop the v1 fallback at L5+ once saves have
// been migrated.
//
// No three.js. Compiles for both the main thread and Workers (L3+).

import { del, get, keys, set } from "idb-keyval";
import { Chunk } from "./Chunk";
import type { ChunkCoord, ChunkKey } from "./types";
import { toChunkKey } from "./types";

/** Bump + add a migrator when the on-disk shape changes. */
export const WORLD_VERSION = 2;

/** The version at which chunks stored only voxels (no light nibble). */
const V1_VERSION = 1;

/** Volume of a 16^3 chunk — expected byte count for a v1 record. */
const VOL_BYTES = 16 * 16 * 16;

const KEY_PREFIX = "chunk:v";

/** Idb-keyval key for a chunk delta at a specific version. */
function chunkKeyAt(version: number, worldId: string, c: ChunkCoord): string {
  return `${KEY_PREFIX}${version}:${worldId}:${toChunkKey(c)}`;
}

/** Idb-keyval key for the current WORLD_VERSION. Shape: `chunk:v<ver>:<worldId>:<cx,cy,cz>`. */
function chunkKey(worldId: string, c: ChunkCoord): string {
  return chunkKeyAt(WORLD_VERSION, worldId, c);
}

/** Prefix for scanning this world's chunk keys under the current version. */
function worldPrefix(worldId: string): string {
  return `${KEY_PREFIX}${WORLD_VERSION}:${worldId}:`;
}

/** Extract the "cx,cy,cz" tail from a full idb-keyval key, or undefined if the key isn't ours. */
function tailOf(fullKey: string, worldId: string): ChunkKey | undefined {
  const prefix = worldPrefix(worldId);
  if (!fullKey.startsWith(prefix)) return undefined;
  return fullKey.slice(prefix.length);
}

/** Normalize whatever idb-keyval hands back (Uint8Array or ArrayBuffer) to a Uint8Array. */
function toBytes(raw: unknown): Uint8Array | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return undefined;
}

/**
 * Fetch raw bytes under a specific version key. Returns undefined if nothing
 * is stored. Caller is responsible for interpreting the shape.
 */
async function fetchRaw(
  version: number,
  worldId: string,
  c: ChunkCoord,
): Promise<Uint8Array | undefined> {
  const raw = await get(chunkKeyAt(version, worldId, c));
  return toBytes(raw);
}

/**
 * Load a chunk's voxel bytes from IDB. Returns undefined if the chunk was never
 * edited (caller falls back to terrainFn).
 *
 * Layout at v2: the on-disk value is a 8192-byte buffer = voxels (4096) ||
 * light (4096). This function returns ONLY the voxels — call
 * `loadChunkLight` for the light array. The split keeps ChunkManager's
 * primeChunk flow (`voxels = await loadChunk(...)`) unchanged across L3 → L4.
 *
 * Falls back to the v1 key if v2 is missing — in which case the result is
 * exactly 4096 voxel bytes with no light companion. See module header for the
 * migration contract.
 */
export async function loadChunk(
  worldId: string,
  c: ChunkCoord,
): Promise<Uint8Array | undefined> {
  const v2 = await fetchRaw(WORLD_VERSION, worldId, c);
  if (v2) {
    // v2 payload is 8192 bytes (voxels || light). Legacy writes under this key
    // may be 4096 bytes (voxels only) — accept both and slice.
    if (v2.length >= VOL_BYTES) {
      // Return a fresh view bounded to the voxel range so callers can safely
      // keep it alive without pinning the trailing light bytes.
      return new Uint8Array(v2.buffer, v2.byteOffset, VOL_BYTES);
    }
    return v2;
  }
  // v1 fallback: 4096 bytes of voxels, no light. Caller sees zero light via
  // loadChunkLight (which returns a zero-filled buffer in this case).
  const v1 = await fetchRaw(V1_VERSION, worldId, c);
  if (v1 && v1.length >= VOL_BYTES) {
    return new Uint8Array(v1.buffer, v1.byteOffset, VOL_BYTES);
  }
  return v1;
}

/**
 * Load a chunk's packed light bytes from IDB. Returns undefined if nothing is
 * stored for the given coord at ANY version — matches `loadChunk`'s
 * never-saved contract so a caller can zip the two Promises.
 *
 * At v2, the light nibble pair is co-located with the voxels in the same key;
 * at v1 (migration lane) light wasn't persisted, so this returns a zero-filled
 * Uint8Array alongside a successful `loadChunk` so the lighting system can
 * re-propagate on its next step.
 */
export async function loadChunkLight(
  worldId: string,
  c: ChunkCoord,
): Promise<Uint8Array | undefined> {
  const v2 = await fetchRaw(WORLD_VERSION, worldId, c);
  if (v2) {
    if (v2.length >= VOL_BYTES * 2) {
      return new Uint8Array(v2.buffer, v2.byteOffset + VOL_BYTES, VOL_BYTES);
    }
    // v2 key but only voxels present — treat as zeroed light.
    return new Uint8Array(VOL_BYTES);
  }
  const v1 = await fetchRaw(V1_VERSION, worldId, c);
  if (v1) {
    return new Uint8Array(VOL_BYTES);
  }
  return undefined;
}

/**
 * Persist a chunk's full voxel + light bytes (8192 B for a 16^3 chunk at v2).
 * L5 can swap in palette compression; the key format reserves the version
 * slot for that.
 */
export async function saveChunk(worldId: string, chunk: Chunk): Promise<void> {
  // Copy the bytes so a later in-place mutation can't retroactively edit the
  // persisted version. idb-keyval structured-clones on write anyway, but being
  // explicit about the snapshot makes the contract obvious.
  const payload = new Uint8Array(VOL_BYTES * 2);
  payload.set(chunk.voxels, 0);
  payload.set(chunk.light, VOL_BYTES);
  await set(chunkKey(worldId, chunk.coord), payload);
}

/** Delete a chunk's delta. The chunk reverts to procedural next time it's streamed in. */
export async function clearChunk(worldId: string, c: ChunkCoord): Promise<void> {
  await del(chunkKey(worldId, c));
  // Also sweep any stale v1 record for the same coord so migration doesn't
  // resurrect it after a clear.
  await del(chunkKeyAt(V1_VERSION, worldId, c));
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
 *
 * Scans ONLY the current WORLD_VERSION prefix: v1 stragglers from the L3 → L4
 * migration are left alone (loader + clearChunk still see them, so they get
 * cleaned up individually). An explicit "sweep every version" pass can be
 * added at L5+ if ever needed.
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
