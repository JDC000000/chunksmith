// World container + the ONE mutation entry point.
// applyBlockChange(intent) is the netcode gate for L5 — do not sneak around it.
// Validation here is intentionally minimal for L2: reach checks live at the
// raycast site (owned by physics-dev), authorization lands with L5 netcode.

import { BLOCKS } from "./blocks";
import type { BlockId } from "./blocks";
import { Chunk, CHUNK_SIZE, chunkIndex } from "./Chunk";
import type {
  BlockChangeIntent,
  BlockChangeResult,
  ChunkCoord,
  ChunkKey,
} from "./types";
import { toChunkKey, worldToChunk } from "./types";

export class World {
  readonly seed: string;
  private readonly chunks: Map<ChunkKey, Chunk> = new Map();

  constructor(seed: string) {
    this.seed = seed;
  }

  getChunk(coord: ChunkCoord): Chunk | undefined {
    return this.chunks.get(toChunkKey(coord));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(toChunkKey(chunk.coord), chunk);
  }

  /** Evict a chunk by coord. Streaming (ChunkManager) uses this when a chunk
   *  walks out of load range. Caller is responsible for disposing GPU resources
   *  first — World stays decoupled from the renderer. Returns true if a chunk
   *  was removed, false if the coord wasn't loaded.
   */
  deleteChunk(coord: ChunkCoord): boolean {
    return this.chunks.delete(toChunkKey(coord));
  }

  loadedChunkCount(): number {
    return this.chunks.size;
  }

  /** Debug-only: lets Playwright probe the chunk roster without exposing the Map directly. */
  loadedChunkKeys(): ChunkKey[] {
    return [...this.chunks.keys()];
  }

  /** Reads a block by world coord. Air if the owning chunk isn't loaded. */
  getBlock(wx: number, wy: number, wz: number): BlockId {
    const { chunk, local } = worldToChunk({ x: wx, y: wy, z: wz }, CHUNK_SIZE);
    const c = this.getChunk(chunk);
    if (!c) return BLOCKS.air;
    return c.voxels[chunkIndex(local.x, local.y, local.z)] as BlockId;
  }

  /**
   * The single legitimate way to mutate world state.
   * - place onto solid -> occupied
   * - break on air -> occupied (we overload the error for L2; L5 can split it)
   * - unloaded owning chunk -> out-of-bounds
   * On success: writes voxel, marks chunk dirty, returns the owning chunk key plus
   * any boundary-neighbor keys the renderer must remesh.
   */
  applyBlockChange(intent: BlockChangeIntent): BlockChangeResult {
    const { chunk: coord, local } = worldToChunk(intent.pos, CHUNK_SIZE);
    const chunk = this.getChunk(coord);
    if (!chunk) return { ok: false, reason: "out-of-bounds" };

    const idx = chunkIndex(local.x, local.y, local.z);
    const existing = chunk.voxels[idx] as BlockId;

    if (intent.reason === "place") {
      if (existing !== BLOCKS.air) return { ok: false, reason: "occupied" };
      chunk.voxels[idx] = intent.blockId;
    } else {
      // break
      if (existing === BLOCKS.air) return { ok: false, reason: "occupied" };
      chunk.voxels[idx] = BLOCKS.air;
    }
    chunk.dirty = true;

    const chunkKey = toChunkKey(coord);
    const dirtyChunks: ChunkKey[] = [chunkKey];
    const S = CHUNK_SIZE - 1;
    if (local.x === 0) dirtyChunks.push(toChunkKey({ cx: coord.cx - 1, cy: coord.cy, cz: coord.cz }));
    if (local.x === S) dirtyChunks.push(toChunkKey({ cx: coord.cx + 1, cy: coord.cy, cz: coord.cz }));
    if (local.y === 0) dirtyChunks.push(toChunkKey({ cx: coord.cx, cy: coord.cy - 1, cz: coord.cz }));
    if (local.y === S) dirtyChunks.push(toChunkKey({ cx: coord.cx, cy: coord.cy + 1, cz: coord.cz }));
    if (local.z === 0) dirtyChunks.push(toChunkKey({ cx: coord.cx, cy: coord.cy, cz: coord.cz - 1 }));
    if (local.z === S) dirtyChunks.push(toChunkKey({ cx: coord.cx, cy: coord.cy, cz: coord.cz + 1 }));

    return { ok: true, chunkKey, dirtyChunks };
  }
}
