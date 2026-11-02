// World-layer value types. No three.js — this file compiles for Workers (L3).
// Branded PlayerId prevents accidental string swaps at the netcode boundary (L5).

import type { BlockId } from "./blocks";
export type { BlockId };

export type PlayerId = string & { __brand: "PlayerId" };

export type BlockCoord = { x: number; y: number; z: number };
export type ChunkCoord = { cx: number; cy: number; cz: number };
export type ChunkKey = string; // "cx,cy,cz"

/**
 * The single mutation intent accepted by World.applyBlockChange.
 * See docs/TSD.md §2.7. Any new field here is a protocol change.
 */
export type BlockChangeIntent = {
  playerId: PlayerId;
  pos: BlockCoord;
  blockId: BlockId;
  reason: "place" | "break";
  timestamp: number;
};

export type BlockChangeResult =
  | { ok: true; chunkKey: ChunkKey; dirtyChunks: ChunkKey[] }
  | { ok: false; reason: "out-of-reach" | "out-of-bounds" | "occupied" | "unauthorized" };

export function toChunkKey(c: ChunkCoord): ChunkKey {
  return `${c.cx},${c.cy},${c.cz}`;
}

export function parseChunkKey(k: ChunkKey): ChunkCoord {
  const [cx, cy, cz] = k.split(",").map(Number);
  return { cx, cy, cz };
}

/** Convert a world coord to its chunk + local coord. Wraps negatives correctly. */
export function worldToChunk(
  w: BlockCoord,
  size: number,
): { chunk: ChunkCoord; local: BlockCoord } {
  const cx = Math.floor(w.x / size);
  const cy = Math.floor(w.y / size);
  const cz = Math.floor(w.z / size);
  return {
    chunk: { cx, cy, cz },
    local: {
      x: ((w.x % size) + size) % size,
      y: ((w.y % size) + size) % size,
      z: ((w.z % size) + size) % size,
    },
  };
}
