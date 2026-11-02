// Builds the single BufferGeometry a chunk owns. One geometry per chunk, period.
// Never per-voxel Mesh — see CLAUDE.md "Architecture rules".

import * as THREE from "three";
import type { MeshData } from "../mesh/naiveMesher";

export function buildChunkMesh(data: MeshData, material: THREE.Material): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  // Per-vertex blockId stays on the geometry so the L6 shader can read it.
  geom.setAttribute("blockId", new THREE.BufferAttribute(data.blockIds, 1));
  geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geom.computeBoundingSphere();
  return new THREE.Mesh(geom, material);
}
