// Chunk streaming. Keeps a 3D box of chunks loaded around a player's world coord,
// generates terrain + mesh for freshly entered chunks, and disposes chunks that
// walked out of range.
//
// NO three.js here — this file compiles for Workers (L3). The renderer-side
// disposer is injected as a callback so this module stays decoupled from THREE.
//
// Called by src/main.ts once per frame; cheap when the player hasn't crossed a
// chunk boundary because update() short-circuits on identical coord sets.

import { Chunk, CHUNK_SIZE } from "./Chunk";
import { World } from "./World";
import { BLOCKS } from "./blocks";
import type { ChunkCoord, ChunkKey } from "./types";
import { toChunkKey } from "./types";
import type { ChunkNeighbors } from "../mesh/naiveMesher";
import { loadChunk, type ChunkPersistence } from "./storage";

/** Terrain generator contract. Same shape as src/gen/terrain.ts#terrainAt. */
export type TerrainFn = (seed: string, cx: number, cy: number, cz: number) => Uint8Array;

/** Builds a mesh for a chunk and attaches it (chunk.mesh = ...). Neighbor-aware. */
export type MeshBuilder = (chunk: Chunk, neighbors: ChunkNeighbors) => void;

/** Releases a chunk's mesh (GPU buffers, scene removal). Called before the chunk is dropped. */
export type ChunkDisposer = (chunk: Chunk) => void;

export interface ChunkStreamUpdate {
  added: ChunkKey[];
  removed: ChunkKey[];
}

export class ChunkManager {
  /** Last target coord used — lets update() short-circuit when nothing moved. */
  private lastTarget: ChunkCoord | null = null;

  constructor(
    readonly world: World,
    readonly terrainFn: TerrainFn,
    readonly meshBuilder: MeshBuilder,
    readonly disposer: ChunkDisposer,
    readonly radiusH: number,
    readonly radiusV: number,
    /**
     * Optional persistence source. When set, primeChunk() checks IDB first
     * and uses the saved delta instead of calling terrainFn. update() stays
     * synchronous — callers that want IDB-backed chunks must await primeChunk
     * for each new coord BEFORE invoking update().
     */
    readonly persistence?: ChunkPersistence,
  ) {}

  /**
   * Load a chunk's voxels (from IDB delta if present, else procedural) and
   * attach it to the World. Idempotent: a second call for the same coord
   * returns immediately. Caller awaits this before `update()` so the sync
   * streaming pass only sees fully-prepared Chunks.
   */
  async primeChunk(coord: ChunkCoord): Promise<Chunk> {
    const existing = this.world.getChunk(coord);
    if (existing) return existing;

    let voxels: Uint8Array | undefined;
    if (this.persistence) {
      voxels = await loadChunk(this.persistence.worldId, coord);
    }
    if (!voxels) {
      voxels = this.terrainFn(this.world.seed, coord.cx, coord.cy, coord.cz);
    }
    const chunk = new Chunk(coord, voxels);
    this.world.setChunk(chunk);
    return chunk;
  }

  /** Chunk coord that owns the given world coord. Floors on each axis. */
  playerChunk(worldX: number, worldY: number, worldZ: number): ChunkCoord {
    return {
      cx: Math.floor(worldX / CHUNK_SIZE),
      cy: Math.floor(worldY / CHUNK_SIZE),
      cz: Math.floor(worldZ / CHUNK_SIZE),
    };
  }

  /** Six orthogonal neighbors of a chunk, pulled from the World map. */
  private neighborsOf(coord: ChunkCoord): ChunkNeighbors {
    return {
      px: this.world.getChunk({ cx: coord.cx + 1, cy: coord.cy, cz: coord.cz }),
      nx: this.world.getChunk({ cx: coord.cx - 1, cy: coord.cy, cz: coord.cz }),
      py: this.world.getChunk({ cx: coord.cx, cy: coord.cy + 1, cz: coord.cz }),
      ny: this.world.getChunk({ cx: coord.cx, cy: coord.cy - 1, cz: coord.cz }),
      pz: this.world.getChunk({ cx: coord.cx, cy: coord.cy, cz: coord.cz + 1 }),
      nz: this.world.getChunk({ cx: coord.cx, cy: coord.cy, cz: coord.cz - 1 }),
    };
  }

  /**
   * Ensure the correct chunks are loaded for a player world coord.
   *
   * Flow:
   *  1. Compute the set of chunks that SHOULD be loaded (axis-aligned box of
   *     radii around the player chunk).
   *  2. Diff against what IS loaded: `added` = new keys, `removed` = evicted keys.
   *  3. Generate terrain + attach Chunk for each added key (deterministic from seed).
   *  4. Mesh each added chunk AND any already-loaded neighbor whose neighbor set
   *     just changed. This is the Day 5a bring-forward of neighbor-aware meshing:
   *     adding a chunk hides a face on each of its orthogonal neighbors.
   *  5. Dispose + delete removed chunks. Also remesh the surviving neighbors
   *     that just lost a boundary (an air->solid flip of the far side).
   */
  update(worldX: number, worldY: number, worldZ: number): ChunkStreamUpdate {
    const target = this.playerChunk(worldX, worldY, worldZ);

    // Fast path: no chunk-boundary crossing since last update → no work.
    if (
      this.lastTarget &&
      this.lastTarget.cx === target.cx &&
      this.lastTarget.cy === target.cy &&
      this.lastTarget.cz === target.cz
    ) {
      return { added: [], removed: [] };
    }

    // --- Compute desired key set ---
    const desired = new Set<ChunkKey>();
    const desiredCoords: ChunkCoord[] = [];
    for (let cy = target.cy - this.radiusV; cy <= target.cy + this.radiusV; cy++) {
      for (let cz = target.cz - this.radiusH; cz <= target.cz + this.radiusH; cz++) {
        for (let cx = target.cx - this.radiusH; cx <= target.cx + this.radiusH; cx++) {
          const coord = { cx, cy, cz };
          const key = toChunkKey(coord);
          desired.add(key);
          desiredCoords.push(coord);
        }
      }
    }

    // --- Diff vs currently loaded ---
    const current = new Set(this.world.loadedChunkKeys());
    const added: ChunkKey[] = [];
    const addedCoords: ChunkCoord[] = [];
    const removed: ChunkKey[] = [];

    for (const coord of desiredCoords) {
      const key = toChunkKey(coord);
      if (!current.has(key)) {
        added.push(key);
        addedCoords.push(coord);
      }
    }
    for (const key of current) {
      if (!desired.has(key)) removed.push(key);
    }

    // --- Generate terrain for added chunks and attach to the world ---
    // Done BEFORE meshing so neighbors can see each other in the same pass.
    for (const coord of addedCoords) {
      const voxels = this.terrainFn(this.world.seed, coord.cx, coord.cy, coord.cz);
      const chunk = new Chunk(coord, voxels);
      this.world.setChunk(chunk);
    }

    // --- Dispose removed chunks BEFORE remeshing their neighbors so the mesher
    //     sees the correct neighbor state (gone → air). ---
    for (const key of removed) {
      const [cx, cy, cz] = key.split(",").map(Number);
      const dead = this.world.getChunk({ cx, cy, cz });
      if (dead) {
        this.disposer(dead);
        this.world.deleteChunk({ cx, cy, cz });
      }
    }

    // --- Remesh set: added chunks + any already-loaded chunk adjacent to an
    //     added or removed one (its exposed-face set just changed). ---
    const remesh = new Set<ChunkKey>();
    for (const key of added) remesh.add(key);
    const perturbed: ChunkCoord[] = [];
    for (const key of added) {
      const [cx, cy, cz] = key.split(",").map(Number);
      perturbed.push({ cx, cy, cz });
    }
    for (const key of removed) {
      const [cx, cy, cz] = key.split(",").map(Number);
      perturbed.push({ cx, cy, cz });
    }
    const offsets: [number, number, number][] = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    for (const c of perturbed) {
      for (const [dx, dy, dz] of offsets) {
        const nc = { cx: c.cx + dx, cy: c.cy + dy, cz: c.cz + dz };
        const nk = toChunkKey(nc);
        // Only remesh if the neighbor exists and is still desired (loaded).
        if (desired.has(nk) && this.world.getChunk(nc)) remesh.add(nk);
      }
    }

    // --- Build meshes. The meshBuilder is responsible for cleaning up any
    //     prior mesh attached to the chunk (scene.remove + geometry.dispose) so
    //     the ChunkManager's own disposer is called exactly once per eviction.
    //     Fast-path all-air chunks: attach a zero-triangle sentinel without
    //     invoking the full mesher. ---
    for (const key of remesh) {
      const [cx, cy, cz] = key.split(",").map(Number);
      const chunk = this.world.getChunk({ cx, cy, cz });
      if (!chunk) continue;

      // All-air fast path: skip the mesher and attach a sentinel empty mesh so
      // the renderer sees chunk.mesh !== undefined (consistent "loaded" state).
      if (isAllAir(chunk)) {
        chunk.mesh = EMPTY_MESH_SENTINEL;
        continue;
      }

      this.meshBuilder(chunk, this.neighborsOf({ cx, cy, cz }));
    }

    this.lastTarget = target;
    return { added, removed };
  }
}

/** True if every voxel in the chunk is air. O(n) over the Uint8Array. */
function isAllAir(chunk: Chunk): boolean {
  const v = chunk.voxels;
  for (let i = 0; i < v.length; i++) {
    if (v[i] !== BLOCKS.air) return false;
  }
  return true;
}

/**
 * Sentinel placed on chunk.mesh when a chunk is all-air. Downstream code
 * (renderer, gameAPI) can duck-type on `.meshData.triangleCount` to see 0 and
 * skip scene insertion. Keeping this a value (not undefined) means "the chunk
 * has been considered for meshing" vs "not yet processed".
 */
const EMPTY_MESH_SENTINEL = Object.freeze({
  meshData: {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
    blockIds: new Uint8Array(0),
    triangleCount: 0,
  },
  geometry: { dispose: () => {} },
  __empty: true as const,
});
