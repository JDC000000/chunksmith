// Naive culled mesher. For each solid voxel, emit a quad for any face whose
// neighbor is air. Boundary faces consult the passed neighbor chunk; a missing
// neighbor is treated as air so the mesh is self-consistent even at world edges.
//
// NO three.js here. This file must stay Worker-transferable for L3.
// Greedy meshing lands at L3 behind a feature flag so we can diff output.

import { WORLD } from "../../design/config";
import { Chunk, chunkIndex, getBlockOrAir } from "../world/Chunk";
import { BLOCKS } from "../world/blocks";
import type { BlockId } from "../world/blocks";

const SIZE = WORLD.CHUNK_SIZE;

export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** One byte per vertex — the shader samples the texture-array layer from it in L6. */
  blockIds: Uint8Array;
  triangleCount: number;
};

export type ChunkNeighbors = {
  px?: Chunk; nx?: Chunk;
  py?: Chunk; ny?: Chunk;
  pz?: Chunk; nz?: Chunk;
};

/** Six face definitions. Order of vertices gives CCW winding when viewed along the normal. */
type Face = {
  // Offset to neighbor voxel.
  dx: number; dy: number; dz: number;
  // Four vertex offsets added to (lx, ly, lz). Each triple is a corner of the unit cube.
  v: [number, number, number, number, number, number, number, number, number, number, number, number];
  n: [number, number, number];
};

const FACES: Face[] = [
  // top (+y)
  { dx: 0, dy: 1, dz: 0, n: [0, 1, 0],
    v: [0,1,0,  1,1,0,  1,1,1,  0,1,1] },
  // bottom (-y)
  { dx: 0, dy: -1, dz: 0, n: [0, -1, 0],
    v: [0,0,1,  1,0,1,  1,0,0,  0,0,0] },
  // +x
  { dx: 1, dy: 0, dz: 0, n: [1, 0, 0],
    v: [1,0,0,  1,0,1,  1,1,1,  1,1,0] },
  // -x
  { dx: -1, dy: 0, dz: 0, n: [-1, 0, 0],
    v: [0,0,1,  0,0,0,  0,1,0,  0,1,1] },
  // +z
  { dx: 0, dy: 0, dz: 1, n: [0, 0, 1],
    v: [1,0,1,  0,0,1,  0,1,1,  1,1,1] },
  // -z
  { dx: 0, dy: 0, dz: -1, n: [0, 0, -1],
    v: [0,0,0,  1,0,0,  1,1,0,  0,1,0] },
];

/** Face-local UVs: match quad vertex order above. */
const FACE_UVS: [number, number, number, number, number, number, number, number] =
  [0, 0,  1, 0,  1, 1,  0, 1];

/** Returns the block id at (lx,ly,lz), reaching into a neighbor chunk if needed. */
function sampleWithNeighbors(
  chunk: Chunk,
  neighbors: ChunkNeighbors,
  lx: number,
  ly: number,
  lz: number,
): BlockId {
  if (lx < 0) return getBlockOrAir(neighbors.nx, SIZE - 1, ly, lz);
  if (lx >= SIZE) return getBlockOrAir(neighbors.px, 0, ly, lz);
  if (ly < 0) return getBlockOrAir(neighbors.ny, lx, SIZE - 1, lz);
  if (ly >= SIZE) return getBlockOrAir(neighbors.py, lx, 0, lz);
  if (lz < 0) return getBlockOrAir(neighbors.nz, lx, ly, SIZE - 1);
  if (lz >= SIZE) return getBlockOrAir(neighbors.pz, lx, ly, 0);
  return chunk.voxels[chunkIndex(lx, ly, lz)] as BlockId;
}

export function meshChunk(chunk: Chunk, neighbors: ChunkNeighbors): MeshData {
  // Collect into dynamic arrays, then pack into typed arrays once we know the size.
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const blockIds: number[] = [];

  const ox = chunk.coord.cx * SIZE;
  const oy = chunk.coord.cy * SIZE;
  const oz = chunk.coord.cz * SIZE;

  for (let y = 0; y < SIZE; y++) {
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        const id = chunk.voxels[chunkIndex(x, y, z)] as BlockId;
        if (id === BLOCKS.air) continue;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nid = sampleWithNeighbors(
            chunk, neighbors,
            x + face.dx, y + face.dy, z + face.dz,
          );
          if (nid !== BLOCKS.air) continue;

          const base = positions.length / 3;
          // 4 vertices
          for (let i = 0; i < 4; i++) {
            const vx = face.v[i * 3 + 0];
            const vy = face.v[i * 3 + 1];
            const vz = face.v[i * 3 + 2];
            positions.push(ox + x + vx, oy + y + vy, oz + z + vz);
            normals.push(face.n[0], face.n[1], face.n[2]);
            uvs.push(FACE_UVS[i * 2 + 0], FACE_UVS[i * 2 + 1]);
            blockIds.push(id);
          }
          // 2 triangles (0,1,2) (0,2,3)
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    blockIds: new Uint8Array(blockIds),
    triangleCount: indices.length / 3,
  };
}
