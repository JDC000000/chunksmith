// Chunk voxel storage. One Uint8Array per 16^3 cube.
// Layout: index = x + z*SIZE + y*SIZE*SIZE. Y-major so horizontal slices are contiguous
// in memory — mesher iterates y then z then x, which stays within a cache line.
// NO three.js here. This file must stay Worker-transferable for L3.

import { WORLD } from "../../design/config";
import type { BlockId } from "./blocks";
import { BLOCKS } from "./blocks";
import type { ChunkCoord } from "./types";

export const CHUNK_SIZE = WORLD.CHUNK_SIZE;
const VOL = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/** Pure index formula. Does not bounds-check — call inBounds first if needed. */
export function chunkIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

export function inBounds(x: number, y: number, z: number): boolean {
  return (
    x >= 0 && x < CHUNK_SIZE &&
    y >= 0 && y < CHUNK_SIZE &&
    z >= 0 && z < CHUNK_SIZE
  );
}

export class Chunk {
  readonly coord: ChunkCoord;
  readonly voxels: Uint8Array;
  /** Set to true on any voxel write; cleared by the renderer after a successful remesh. */
  dirty: boolean;
  /**
   * Optional back-pointer to the live mesh so the renderer can swap geometry in place.
   * Typed as unknown here to keep this module free of three.js imports.
   */
  mesh?: unknown;

  constructor(coord: ChunkCoord, voxels?: Uint8Array) {
    this.coord = coord;
    this.voxels = voxels ?? new Uint8Array(VOL);
    this.dirty = false;
  }
}

export function getBlock(chunk: Chunk, lx: number, ly: number, lz: number): BlockId {
  return chunk.voxels[chunkIndex(lx, ly, lz)] as BlockId;
}

export function setBlock(
  chunk: Chunk,
  lx: number,
  ly: number,
  lz: number,
  id: BlockId,
): void {
  chunk.voxels[chunkIndex(lx, ly, lz)] = id;
  chunk.dirty = true;
}

/** Convenience: read with air fallback if the chunk is undefined (used at seams). */
export function getBlockOrAir(
  chunk: Chunk | undefined,
  lx: number,
  ly: number,
  lz: number,
): BlockId {
  if (!chunk) return BLOCKS.air;
  return getBlock(chunk, lx, ly, lz);
}
