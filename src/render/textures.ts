// Procedural texture atlas for L2 blocks. One THREE.DataArrayTexture, one layer per
// unique face texture referenced by BLOCK_FACES. Layer indices here are the single
// source of truth that BLOCK_FACES references — reorder them and you must update
// src/world/blocks.ts in the same change.
//
// Deterministic by design: seeded through src/core/rng so screenshot baselines don't
// shift between dev / CI. 16×16 pixels per layer is enough for L2 crispness; the
// shader samples with NearestFilter so pixels stay sharp.
//
// No Mojang IP: palette and style are generic voxel-sandbox fare.

import * as THREE from "three";
import { rngFromSeed } from "../core/rng";

const TEX_SIZE = 16;

/** Layer indices into the DataArrayTexture. BLOCK_FACES references these. */
export const BLOCK_TEX_LAYERS = {
  grassTop:  0,
  grassSide: 1,
  dirt:      2,
  stone:     3,
} as const;

export type BlockTexLayer = typeof BLOCK_TEX_LAYERS[keyof typeof BLOCK_TEX_LAYERS];

/** Number of layers in the atlas. Keeps atlas sizing + tests in sync. */
export const NUM_LAYERS = Object.keys(BLOCK_TEX_LAYERS).length;

function clampByte(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n | 0;
}

/** Writes RGBA for a single pixel into the atlas buffer at (layer, x, y). */
function putPixel(
  data: Uint8Array,
  layer: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void {
  const pxPerLayer = TEX_SIZE * TEX_SIZE;
  const base = (layer * pxPerLayer + y * TEX_SIZE + x) * 4;
  data[base + 0] = clampByte(r);
  data[base + 1] = clampByte(g);
  data[base + 2] = clampByte(b);
  data[base + 3] = 255;
}

/** Fill a layer with a base RGB plus seeded ±jitter per pixel. */
function fillNoise(
  data: Uint8Array,
  layer: number,
  base: [number, number, number],
  jitter: number,
  seed: string,
): void {
  const rng = rngFromSeed(seed);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const n = (rng() - 0.5) * 2 * jitter;
      putPixel(data, layer, x, y,
        base[0] + n,
        base[1] + n,
        base[2] + n,
      );
    }
  }
}

/** Grass side: brown dirt in the bottom 1/3, green in the top 2/3, a 1-pixel blend seam. */
function fillGrassSide(data: Uint8Array, layer: number, seed: string): void {
  const rng = rngFromSeed(seed);
  const dirt: [number, number, number] = [120, 85, 55];
  const grass: [number, number, number] = [85, 150, 60];
  const seamY = Math.floor(TEX_SIZE * 2 / 3); // top 2/3 is grass -> seam at this row from the bottom
  // Image Y goes top->bottom in GPU terms, but we're writing deterministic bytes;
  // "bottom 1/3" visually is high y when sampled with v=0 at top. Just pick a convention.
  for (let y = 0; y < TEX_SIZE; y++) {
    const inGrass = y < seamY; // top rows (small y) = grass
    const inDirt  = y > seamY;
    for (let x = 0; x < TEX_SIZE; x++) {
      const n = (rng() - 0.5) * 2 * 10;
      let r: number, g: number, b: number;
      if (inGrass) {
        r = grass[0] + n; g = grass[1] + n; b = grass[2] + n;
      } else if (inDirt) {
        r = dirt[0] + n; g = dirt[1] + n; b = dirt[2] + n;
      } else {
        // Seam row: average of neighbors so top-of-dirt blends into bottom-of-grass.
        r = (grass[0] + dirt[0]) / 2 + n;
        g = (grass[1] + dirt[1]) / 2 + n;
        b = (grass[2] + dirt[2]) / 2 + n;
      }
      putPixel(data, layer, x, y, r, g, b);
    }
  }
}

/**
 * Build the per-block face-texture atlas. Cheap enough to run at startup
 * (<1 ms in practice: NUM_LAYERS * 256 pixels, 4 bytes each).
 */
export function createBlockTextureArray(): THREE.DataArrayTexture {
  const bytesPerLayer = TEX_SIZE * TEX_SIZE * 4;
  const data = new Uint8Array(bytesPerLayer * NUM_LAYERS);

  // Each layer gets its own seed string so changing one palette doesn't disturb another.
  // Grass top: strong green with slight hue variation per pixel.
  fillNoise(data, BLOCK_TEX_LAYERS.grassTop,  [95, 165, 65], 14, "tex-grass-top");
  // Grass side: brown-at-bottom, green-on-top with a thin seam.
  fillGrassSide(data, BLOCK_TEX_LAYERS.grassSide, "tex-grass-side");
  // Dirt: warm brown noise.
  fillNoise(data, BLOCK_TEX_LAYERS.dirt,      [120, 85, 55], 12, "tex-dirt");
  // Stone: cool grey with a touch of blue in the base to read as stone, not concrete.
  fillNoise(data, BLOCK_TEX_LAYERS.stone,     [128, 130, 138], 10, "tex-stone");

  const tex = new THREE.DataArrayTexture(data, TEX_SIZE, TEX_SIZE, NUM_LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  // Keep pixels crisp — matches voxel-sandbox aesthetic and sidesteps the hairy
  // DataArrayTexture mipmap-generation path on WebGL2.
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // DataArrayTexture in three@0.187 types wrapR as a boolean on this class; the
  // layer coord isn't wrapped as a UV anyway, so skip it.
  tex.needsUpdate = true;
  return tex;
}
