// Factory for the per-chunk material.
// L2: a flat Lambert in grass-green so dev scenes read correctly.
// L6: swap for a ShaderMaterial that samples a texture-array indexed by the
// per-vertex blockId attribute the mesher already emits.

import * as THREE from "three";

export function createChunkMaterial(): THREE.Material {
  return new THREE.MeshLambertMaterial({ color: 0x7cb342 });
}
