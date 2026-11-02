import { describe, test, expect } from "vitest";
import * as THREE from "three";
import { createBlockTextureArray, BLOCK_TEX_LAYERS } from "../../src/render/textures";

describe("createBlockTextureArray", () => {
  test("returns a DataArrayTexture", () => {
    const atlas = createBlockTextureArray();
    expect((atlas as unknown as { isDataArrayTexture?: boolean }).isDataArrayTexture).toBe(true);
    expect(atlas).toBeInstanceOf(THREE.DataArrayTexture);
  });

  test("image dimensions are 16x16 with at least 4 layers", () => {
    const atlas = createBlockTextureArray();
    expect(atlas.image.width).toBe(16);
    expect(atlas.image.height).toBe(16);
    expect(atlas.image.depth).toBeGreaterThanOrEqual(4);
  });

  test("underlying data is a Uint8Array of width*height*4*depth", () => {
    const atlas = createBlockTextureArray();
    const img = atlas.image as { data: Uint8Array; width: number; height: number; depth: number };
    expect(img.data).toBeInstanceOf(Uint8Array);
    expect(img.data.length).toBe(img.width * img.height * 4 * img.depth);
  });

  test("deterministic — repeated calls produce byte-identical atlases", () => {
    const a = createBlockTextureArray();
    const b = createBlockTextureArray();
    const da = (a.image as { data: Uint8Array }).data;
    const db = (b.image as { data: Uint8Array }).data;
    expect(da.length).toBe(db.length);
    // Sample first 128 bytes AND last 128 bytes so we catch late-pyramid drift too.
    for (let i = 0; i < Math.min(128, da.length); i++) expect(db[i]).toBe(da[i]);
    for (let i = da.length - 128; i < da.length; i++) expect(db[i]).toBe(da[i]);
  });

  test("grass-top layer is predominantly green", () => {
    const atlas = createBlockTextureArray();
    const img = atlas.image as { data: Uint8Array; width: number; height: number; depth: number };
    const pixelsPerLayer = img.width * img.height; // 256
    const bytesPerLayer = pixelsPerLayer * 4;
    const layerStart = BLOCK_TEX_LAYERS.grassTop * bytesPerLayer;
    let sumR = 0, sumG = 0, sumB = 0;
    for (let p = 0; p < pixelsPerLayer; p++) {
      sumR += img.data[layerStart + p * 4 + 0];
      sumG += img.data[layerStart + p * 4 + 1];
      sumB += img.data[layerStart + p * 4 + 2];
    }
    expect(sumG).toBeGreaterThan(sumR);
    expect(sumG).toBeGreaterThan(sumB);
  });

  test("BLOCK_TEX_LAYERS line up with BLOCK_FACES expectations", () => {
    // These indices are the single source of truth that BLOCK_FACES references.
    // Keep them stable; changing values here is a breaking schema change.
    expect(BLOCK_TEX_LAYERS.grassTop).toBe(0);
    expect(BLOCK_TEX_LAYERS.grassSide).toBe(1);
    expect(BLOCK_TEX_LAYERS.dirt).toBe(2);
    expect(BLOCK_TEX_LAYERS.stone).toBe(3);
  });

  test("alpha channel is fully opaque across the whole atlas", () => {
    const atlas = createBlockTextureArray();
    const img = atlas.image as { data: Uint8Array; width: number; height: number; depth: number };
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);
    }
  });
});
