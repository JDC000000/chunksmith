// Factory for the per-chunk material.
// L6: samples the per-block face texture atlas (a DataArrayTexture) using the
// per-vertex `layer` byte emitted by the naive mesher. The vertex shader forwards
// uv + layer + a camera-space normal; the fragment samples sampler2DArray and
// modulates by a sun-direction dot (fed by src/render/dayNight.ts) so facets
// still read as solid blocks and lighting follows the day/night cycle.
//
// GLSL3 is required for `sampler2DArray` — the material pins that version here so
// callers don't have to think about it.

import * as THREE from "three";
import type { DayNightState } from "./dayNight";

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
  // Camera-space normal; the sun direction uniform is also pushed in camera
  // space by the host (see updateDayNight below) so the dot is apples-to-apples.
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
uniform vec3 uSunDir;        // world-space; host multiplies by view normalMatrix if desired
uniform float uAmbient;      // ambient coefficient from dayNight.ambientIntensity
uniform float uSunIntensity; // direct sun contribution from dayNight.sunIntensity

out vec4 outColor;

void main() {
  float layerIdx = floor(vLayer + 0.5);
  vec4 texel = texture(uAtlas, vec3(vUv, layerIdx));

  float sunDot = max(0.0, dot(vNormal, normalize(uSunDir)));
  float light = uAmbient + sunDot * uSunIntensity;
  outColor = vec4(texel.rgb * light, texel.a);
}
`;

/** Chunk material with a day/night updater bolted on. */
export type ChunkShaderMaterial = THREE.ShaderMaterial & {
  /** Push the latest DayNightState into the uniforms. Cheap — one assign per frame. */
  updateDayNight(state: DayNightState): void;
};

/**
 * Build the shader material that samples the block texture atlas.
 * Callers construct one material at startup and share it across every chunk mesh.
 */
export function createChunkMaterial(atlas: THREE.DataArrayTexture): ChunkShaderMaterial {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uAtlas: { value: atlas },
      // Sensible noon defaults so a renderer that forgets to call updateDayNight
      // still shows a lit scene instead of a black one.
      uSunDir: { value: new THREE.Vector3(0.4, 0.9, 0.3).normalize() },
      uAmbient: { value: 0.6 },
      uSunIntensity: { value: 1.0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: false,
  }) as unknown as ChunkShaderMaterial;

  material.updateDayNight = function (state: DayNightState): void {
    const dir = this.uniforms.uSunDir.value as THREE.Vector3;
    dir.set(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z);
    this.uniforms.uAmbient.value = state.ambientIntensity;
    this.uniforms.uSunIntensity.value = state.sunIntensity;
  };

  return material;
}
