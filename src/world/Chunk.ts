// Chunk voxel storage. One Uint8Array per 16^3 cube.
// Layout: index = x + z*SIZE + y*SIZE*SIZE. Y-major so horizontal slices are contiguous
// in memory — mesher iterates y then z then x, which stays within a cache line.
// NO three.js here. This file must stay Worker-transferable for L3.
//
// L4 adds a parallel `light` Uint8Array of the same length. Each byte stores
// skylight in the high nibble and block-light in the low nibble so a single
// typed-array passes to the mesher per chunk (see ADR-0014). The two nibbles
// propagate independently; the shader composes them with `max()`.

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
  /**
   * Per-cell light byte. High nibble = skylight (0..15), low nibble = block-light
   * (0..15). Owned by `src/world/lighting.ts`; the renderer only READS this via
   * the mesher. See ADR-0014.
   */
  readonly light: Uint8Array;
  /** Set to true on any voxel write; cleared by the renderer after a successful remesh. */
  dirty: boolean;
  /**
   * Optional back-pointer to the live mesh so the renderer can swap geometry in place.
   * Typed as unknown here to keep this module free of three.js imports.
   */
  mesh?: unknown;

  constructor(coord: ChunkCoord, voxels?: Uint8Array, light?: Uint8Array) {
    this.coord = coord;
    this.voxels = voxels ?? new Uint8Array(VOL);
    // Fresh chunks default to all-dark; the lighting system seeds skylight on
    // its first `step()` after the chunk is attached.
    this.light = light ?? new Uint8Array(VOL);
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

// ---------------------------------------------------------------------------
// Light byte helpers. All operate on the packed (sky<<4 | blk) layout.
// ---------------------------------------------------------------------------

/** Pack two 0..15 nibbles into a single byte. Inputs are masked to 4 bits. */
export function packLight(sky: number, blk: number): number {
  return ((sky & 0x0f) << 4) | (blk & 0x0f);
}

/** Split a byte back into (sky, blk) nibbles. */
export function unpackLight(byte: number): { sky: number; blk: number } {
  return { sky: (byte >> 4) & 0x0f, blk: byte & 0x0f };
}

export function getBlockLight(chunk: Chunk, lx: number, ly: number, lz: number): number {
  return chunk.light[chunkIndex(lx, ly, lz)] & 0x0f;
}

export function getSkylight(chunk: Chunk, lx: number, ly: number, lz: number): number {
  return (chunk.light[chunkIndex(lx, ly, lz)] >> 4) & 0x0f;
}

export function setBlockLight(
  chunk: Chunk, lx: number, ly: number, lz: number, value: number,
): void {
  const idx = chunkIndex(lx, ly, lz);
  const prev = chunk.light[idx];
  chunk.light[idx] = (prev & 0xf0) | (value & 0x0f);
}

export function setSkylight(
  chunk: Chunk, lx: number, ly: number, lz: number, value: number,
): void {
  const idx = chunkIndex(lx, ly, lz);
  const prev = chunk.light[idx];
  chunk.light[idx] = ((value & 0x0f) << 4) | (prev & 0x0f);
}

/** Seam helper: light byte at (lx,ly,lz) in `chunk`, or 0 if chunk is undefined. */
export function getLightByteOrZero(
  chunk: Chunk | undefined,
  lx: number,
  ly: number,
  lz: number,
): number {
  if (!chunk) return 0;
  return chunk.light[chunkIndex(lx, ly, lz)];
}
