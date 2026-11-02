// Factory for the per-chunk material.
//
// L6 shipped: samples the per-block face texture atlas (a DataArrayTexture)
// using the per-vertex `layer` byte emitted by the naive mesher. The vertex
// shader forwards uv + layer + a camera-space normal; the fragment samples
// sampler2DArray and modulates by a sun-direction dot (fed by
// src/render/dayNight.ts) so facets still read as solid blocks and lighting
// follows the day/night cycle.
//
// L4 extends the material to sample per-vertex `blockLight` and `skylight`
// u8 attributes (ADR-0017). The fragment shader composes:
//   final = albedo * max(sky, max(TORCH_BRIGHTNESS_MIN * blk, blk) * flicker)
// where `flicker` is a cheap in-shader hash-based noise driven by uTime, so
// torches read as a living flame WITHOUT touching JS. The L3 sun dot stays
// in the mix via max() so day/night still composes.
//
// GLSL3 is required for `sampler2DArray` — the material pins that version here so
// callers don't have to think about it.

import * as THREE from "three";
import { LIGHTING } from "../../design/config";
import type { DayNightState } from "./dayNight";

const VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec2 uv;
in float layer;
in float blockLight;
in float skylight;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

out vec2 vUv;
out float vLayer;
out vec3 vNormal;
out float vBlockLight;
out float vSkylight;
out vec3 vWorldPos;

void main() {
  vUv = uv;
  vLayer = layer;
  vBlockLight = blockLight;
  vSkylight = skylight;
  // Camera-space normal; the sun direction uniform is also pushed in camera
  // space by the host (see updateDayNight below) so the dot is apples-to-apples.
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos4.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader. Constants are injected at build time from the LIGHTING
 * namespace so a Jon-tunable change in design/config.ts shows up without
 * touching this file.
 */
function buildFragmentShader(): string {
  return /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2DArray;

#define TORCH_BRIGHTNESS_MIN ${LIGHTING.TORCH_BRIGHTNESS_MIN.toFixed(5)}
#define TORCH_FLICKER_AMPLITUDE ${LIGHTING.TORCH_FLICKER_AMPLITUDE.toFixed(5)}
#define TORCH_FLICKER_HZ ${LIGHTING.TORCH_FLICKER_HZ.toFixed(5)}

in vec2 vUv;
in float vLayer;
in vec3 vNormal;
in float vBlockLight;
in float vSkylight;
in vec3 vWorldPos;

uniform sampler2DArray uAtlas;
uniform vec3 uSunDir;        // world-space; host multiplies by view normalMatrix if desired
uniform float uAmbient;      // ambient coefficient from dayNight.ambientIntensity
uniform float uSunIntensity; // direct sun contribution from dayNight.sunIntensity
uniform float uTime;         // seconds since start, drives the flicker

out vec4 outColor;

// Cheap hash-based 2D value noise. No texture lookup, no Math.random — the
// shader is deterministic given (vWorldPos, uTime) which is exactly what we
// want for playwright screenshot stability at a fixed uTime.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  float layerIdx = floor(vLayer + 0.5);
  vec4 texel = texture(uAtlas, vec3(vUv, layerIdx));

  // Day/night: sun dot drives directional light; ambient keeps unlit faces
  // readable at night.
  float sunDot = max(0.0, dot(vNormal, normalize(uSunDir)));
  float sunTerm = uAmbient + sunDot * uSunIntensity;

  // Voxel light composition — ADR-0017:
  //   sky = vSkylight / 15
  //   blk = vBlockLight / 15
  //   flk = 1 + AMPLITUDE * (noise - 0.5) * 2   (centered flicker)
  //   light = max(sky, max(TORCH_BRIGHTNESS_MIN, blk) * flk)
  float sky = vSkylight / 15.0;
  float blk = vBlockLight / 15.0;
  float flk = 1.0 + TORCH_FLICKER_AMPLITUDE *
              (noise2(vWorldPos.xz * 0.5 + vec2(uTime * TORCH_FLICKER_HZ)) - 0.5) * 2.0;
  float voxelLight = max(sky, max(TORCH_BRIGHTNESS_MIN * blk, blk) * flk);

  // Compose multiplicatively against sunTerm so day/night still modulates
  // lit regions, but take max with voxelLight so a torch in a dark cave
  // reads as lit even when sun is below the horizon.
  float light = max(sunTerm, voxelLight);

  outColor = vec4(texel.rgb * light, texel.a);
}
`;
}

/** Chunk material with a day/night updater bolted on. */
export type ChunkShaderMaterial = THREE.ShaderMaterial & {
  /** Push the latest DayNightState into the uniforms. Cheap — one assign per frame. */
  updateDayNight(state: DayNightState): void;
  /** Advance the time uniform for torch flicker. Call from main render loop. */
  updateTime(seconds: number): void;
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
      uTime: { value: 0.0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: buildFragmentShader(),
    side: THREE.FrontSide,
    transparent: false,
  }) as unknown as ChunkShaderMaterial;

  material.updateDayNight = function (state: DayNightState): void {
    const dir = this.uniforms.uSunDir.value as THREE.Vector3;
    dir.set(state.sunDirection.x, state.sunDirection.y, state.sunDirection.z);
    this.uniforms.uAmbient.value = state.ambientIntensity;
    this.uniforms.uSunIntensity.value = state.sunIntensity;
  };

  material.updateTime = function (seconds: number): void {
    this.uniforms.uTime.value = seconds;
  };

  return material;
}
