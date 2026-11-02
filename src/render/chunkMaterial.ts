// Factory for the per-chunk material.
// L6: samples the per-block face texture atlas (a DataArrayTexture) using the
// per-vertex `layer` byte emitted by the naive mesher. The vertex shader forwards
// uv + layer + a camera-space normal; the fragment samples sampler2DArray and
// modulates by a hard-coded sun-direction dot so facets still read as solid blocks.
//
// GLSL3 is required for `sampler2DArray` — the material pins that version here so
// callers don't have to think about it.

import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;
in float layer;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

out vec2 vUv;
out float vLayer;
out vec3 vNormal;

void main() {
  vUv = uv;
  vLayer = layer;
  // World-space normal is sufficient for the hard-coded sun dir below.
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

in vec2 vUv;
in float vLayer;
in vec3 vNormal;

uniform sampler2DArray uAtlas;

out vec4 outColor;

void main() {
  // Round the layer index — the vertex attribute is a Uint8 cast to float.
  float layerIdx = floor(vLayer + 0.5);
  vec4 texel = texture(uAtlas, vec3(vUv, layerIdx));

  // Hard-coded sun. Baked-in half-ambient so down-faces don't go black.
  vec3 sunDir = normalize(vec3(0.4, 0.9, 0.3));
  float light = 0.5 + 0.5 * max(0.0, dot(normalize(vNormal), sunDir));
  outColor = vec4(texel.rgb * light, texel.a);
}
`;

/**
 * Build the shader material that samples the block texture atlas.
 * Callers construct one material at startup and share it across every chunk mesh.
 */
export function createChunkMaterial(atlas: THREE.DataArrayTexture): THREE.ShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uAtlas: { value: atlas },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: false,
  });
}
