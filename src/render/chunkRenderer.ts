// Builds the single BufferGeometry a chunk owns. One geometry per chunk, period.
// Never per-voxel Mesh — see CLAUDE.md "Architecture rules".
//
// L4 adds per-vertex `blockLight` and `skylight` u8 attributes alongside the
// existing `layer`/`blockId`. The chunk shader reads both and composes them
// with the day/night sun term (see src/render/chunkMaterial.ts).

import * as THREE from "three";
import type { MeshData } from "../mesh/naiveMesher";

export function buildChunkMesh(data: MeshData, material: THREE.Material): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geom.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  // Per-vertex blockId stays on the geometry for tooling / debug readers.
  geom.setAttribute("blockId", new THREE.BufferAttribute(data.blockIds, 1));
  // Per-vertex texture-array layer — the chunk shader samples the atlas by it.
  geom.setAttribute("layer", new THREE.BufferAttribute(data.layer, 1));
  // Per-vertex light nibbles. 0..15 encoded as u8; shader divides by 15.
  geom.setAttribute("blockLight", new THREE.BufferAttribute(data.blockLight, 1));
  geom.setAttribute("skylight", new THREE.BufferAttribute(data.skylight, 1));
  geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geom.computeBoundingSphere();
  return new THREE.Mesh(geom, material);
}
