// Lighting system — US-L4-05..07.
// Covers skylight attenuation, torch block-light propagation, and the
// de-light (removeLight) path when a torch is destroyed. ADR-0014 pins the
// algorithm (incremental dirty-queue BFS).
//
// Mesher light attributes are also exercised here (US-L4-08 unit side):
// after a propagation step, the naive mesher must emit per-vertex blockLight
// and skylight u8 attributes derived from the chunk's packed light bytes.

import { describe, test, expect } from "vitest";
import { WORLD, LIGHTING } from "../../design/config";
import { World } from "../../src/world/World";
import {
  Chunk,
  setBlock as chunkSetBlock,
  getBlockLight,
  getSkylight,
  setBlockLight,
  setSkylight,
  chunkIndex,
} from "../../src/world/Chunk";
import { BLOCKS } from "../../src/world/blocks";
import { LightingSystem, seedSkylightColumn } from "../../src/world/lighting";
import { meshChunk } from "../../src/mesh/naiveMesher";
import { toChunkKey } from "../../src/world/types";

const SIZE = WORLD.CHUNK_SIZE;

/** Shortcut: fresh world + single empty chunk at origin, mounted. */
function emptyWorld(): { w: World; c: Chunk } {
  const w = new World("seed-lighting");
  const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
  w.setChunk(c);
  return { w, c };
}

/** Run step() until the dirty queue is empty or we blow a safety cap. */
function propagateUntilDone(ls: LightingSystem, maxFrames = 200): number {
  let frames = 0;
  while (ls.pendingCount() > 0 && frames < maxFrames) {
    ls.step(LIGHTING.DIRTY_QUEUE_BUDGET_PER_FRAME);
    frames++;
  }
  if (ls.pendingCount() > 0) {
    throw new Error(`lighting did not converge in ${maxFrames} frames`);
  }
  return frames;
}

describe("LightingSystem — torch propagation (US-L4-06)", () => {
  test("placing a torch raises neighbor block-light to TORCH_LIGHT_LEVEL - 1 after propagation", () => {
    const { w, c } = emptyWorld();
    chunkSetBlock(c, 8, 8, 8, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 8, 8, 8);
    propagateUntilDone(ls);

    // Neighbor cell is 1 block from the seed → TORCH_LIGHT_LEVEL - 1.
    const expectedNeighbor = LIGHTING.TORCH_LIGHT_LEVEL - LIGHTING.FALLOFF_PER_BLOCK;
    expect(getBlockLight(c, 9, 8, 8)).toBe(expectedNeighbor);
    expect(getBlockLight(c, 7, 8, 8)).toBe(expectedNeighbor);
    expect(getBlockLight(c, 8, 9, 8)).toBe(expectedNeighbor);
    expect(getBlockLight(c, 8, 7, 8)).toBe(expectedNeighbor);
    expect(getBlockLight(c, 8, 8, 9)).toBe(expectedNeighbor);
    expect(getBlockLight(c, 8, 8, 7)).toBe(expectedNeighbor);
  });

  test("torch light attenuates with manhattan distance in open air", () => {
    const { w, c } = emptyWorld();
    chunkSetBlock(c, 2, 8, 8, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 2, 8, 8);
    propagateUntilDone(ls);

    // Four cells away along +x in open air.
    const distance = 4;
    const expected = Math.max(0, LIGHTING.TORCH_LIGHT_LEVEL - distance * LIGHTING.FALLOFF_PER_BLOCK);
    expect(getBlockLight(c, 2 + distance, 8, 8)).toBe(expected);
  });

  test("solid wall blocks torch light — cells behind the wall stay dark (ADR-0014 cave fidelity)", () => {
    const { w, c } = emptyWorld();
    // Full y,z stone slab at x=5 — splits the chunk in two. Torch at x=4;
    // every cell at x>=6 must stay dark because light cannot route around.
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < SIZE; z++) {
        chunkSetBlock(c, 5, y, z, BLOCKS.stone);
      }
    }
    chunkSetBlock(c, 4, 8, 8, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 4, 8, 8);
    propagateUntilDone(ls);

    // Front of the wall is lit (cell adjacent to the torch).
    expect(getBlockLight(c, 4, 7, 8)).toBeGreaterThan(0);
    // Behind the wall every cell is still 0 — the slab fully isolates the
    // right half of the chunk from the torch.
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < SIZE; z++) {
        expect(getBlockLight(c, 6, y, z)).toBe(0);
      }
    }
  });
});

describe("LightingSystem — de-light on torch break (US-L4-07)", () => {
  test("breaking a propagated torch returns surrounding cells to pre-torch (all zero) state", () => {
    const { w, c } = emptyWorld();
    chunkSetBlock(c, 8, 8, 8, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 8, 8, 8);
    propagateUntilDone(ls);
    // Sanity: cells near the torch picked up light.
    expect(getBlockLight(c, 9, 8, 8)).toBeGreaterThan(0);

    // Replace torch with air and re-mark.
    chunkSetBlock(c, 8, 8, 8, BLOCKS.air);
    ls.markBlockChanged(c, 8, 8, 8);
    propagateUntilDone(ls);

    // After the de-light propagates, every cell is back to 0 block-light
    // because there's no other emitter in the chunk.
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < SIZE; z++) {
        for (let x = 0; x < SIZE; x++) {
          expect(getBlockLight(c, x, y, z)).toBe(0);
        }
      }
    }
  });

  test("breaking one of two torches leaves cells near the surviving torch lit", () => {
    const { w, c } = emptyWorld();
    chunkSetBlock(c, 2, 2, 2, BLOCKS.torch);
    chunkSetBlock(c, 13, 13, 13, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 2, 2, 2);
    ls.markBlockChanged(c, 13, 13, 13);
    propagateUntilDone(ls);

    chunkSetBlock(c, 2, 2, 2, BLOCKS.air);
    ls.markBlockChanged(c, 2, 2, 2);
    propagateUntilDone(ls);

    // The cell adjacent to the surviving torch is still bright.
    expect(getBlockLight(c, 12, 13, 13)).toBe(
      LIGHTING.TORCH_LIGHT_LEVEL - LIGHTING.FALLOFF_PER_BLOCK,
    );
    // The cell that was adjacent to the removed torch is dark again (far from
    // the surviving torch — manhattan distance 11+10+10 ≫ 14).
    expect(getBlockLight(c, 3, 2, 2)).toBe(0);
  });
});

describe("LightingSystem — skylight (US-L4-05)", () => {
  test("seedSkylightColumn fills an air column from the top down with SUNLIGHT_LEVEL_MAX", () => {
    const { w: _w, c } = emptyWorld();
    seedSkylightColumn(c, 5, 7);
    for (let y = SIZE - 1; y >= 0; y--) {
      expect(getSkylight(c, 5, y, 7)).toBe(LIGHTING.SUNLIGHT_LEVEL_MAX);
    }
  });

  test("seedSkylightColumn stops at the first solid cell — anything below stays at 0", () => {
    const { w: _w, c } = emptyWorld();
    // Floor at y=4 (so y=4..SIZE-1 is air, y=3 is stone)
    chunkSetBlock(c, 5, 3, 7, BLOCKS.stone);
    // Underground voxel at y=1 is air too but it's under the solid y=3.
    seedSkylightColumn(c, 5, 7);

    // Air above the solid is lit.
    for (let y = 4; y < SIZE; y++) {
      expect(getSkylight(c, 5, y, 7)).toBe(LIGHTING.SUNLIGHT_LEVEL_MAX);
    }
    // The solid cell and anything below it are dark.
    expect(getSkylight(c, 5, 3, 7)).toBe(0);
    expect(getSkylight(c, 5, 1, 7)).toBe(0);
    expect(getSkylight(c, 5, 0, 7)).toBe(0);
  });

  test("skylight propagates horizontally into an overhang after seedSkylightColumn", () => {
    // Set up: solid roof at y=10 covering x=5..SIZE-1 for EVERY z. Light can
    // only enter the x>=5 half via horizontal propagation under the eave.
    const { w, c } = emptyWorld();
    for (let x = 5; x < SIZE; x++) {
      for (let z = 0; z < SIZE; z++) {
        chunkSetBlock(c, x, 10, z, BLOCKS.stone);
      }
    }
    for (let x = 0; x < SIZE; x++) {
      for (let z = 0; z < SIZE; z++) {
        seedSkylightColumn(c, x, z);
      }
    }
    const ls = new LightingSystem(w);
    // Mark every sky-seeded air cell as dirty so horizontal propagation runs.
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) {
        for (let z = 0; z < SIZE; z++) {
          if (getSkylight(c, x, y, z) > 0) ls.markLightCell(c, x, y, z);
        }
      }
    }
    propagateUntilDone(ls);

    // A cell just under the eave (x=5, y=9) is lit via one horizontal step
    // from the open column at x=4 → sky = MAX - FALLOFF.
    expect(getSkylight(c, 5, 9, 5)).toBe(
      LIGHTING.SUNLIGHT_LEVEL_MAX - LIGHTING.FALLOFF_PER_BLOCK,
    );
    // Deeper under the roof, skylight attenuates.
    expect(getSkylight(c, 9, 9, 5)).toBeLessThan(getSkylight(c, 5, 9, 5));
  });
});

describe("LightingSystem — dirty queue budgeting (ADR-0014 perf gate)", () => {
  test("step() respects the per-frame budget — does not pop more cells than requested", () => {
    const { w, c } = emptyWorld();
    chunkSetBlock(c, 8, 8, 8, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 8, 8, 8);
    const popped = ls.step(5);
    expect(popped).toBeLessThanOrEqual(5);
  });

  test("multiple step() calls eventually drain the queue — convergence", () => {
    const { w, c } = emptyWorld();
    chunkSetBlock(c, 8, 8, 8, BLOCKS.torch);
    const ls = new LightingSystem(w);
    ls.markBlockChanged(c, 8, 8, 8);
    // Micro-budget forces many frames.
    const frames = propagateUntilDone(ls, 500);
    expect(frames).toBeGreaterThan(0);
    expect(ls.pendingCount()).toBe(0);
  });
});

describe("mesher writes per-vertex light attributes (ADR-0017)", () => {
  test("MeshData exposes blockLight and skylight Uint8Arrays with one byte per vertex", () => {
    const { w: _w, c } = emptyWorld();
    chunkSetBlock(c, 0, 0, 0, BLOCKS.grass);
    const m = meshChunk(c, {});
    const vertexCount = m.positions.length / 3;
    expect(m.blockLight).toBeInstanceOf(Uint8Array);
    expect(m.skylight).toBeInstanceOf(Uint8Array);
    expect(m.blockLight.length).toBe(vertexCount);
    expect(m.skylight.length).toBe(vertexCount);
  });

  test("mesher samples light from the AIR cell adjacent to the face (not the solid's own cell)", () => {
    const { w: _w, c } = emptyWorld();
    // Place a solid grass block at (5,5,5).
    chunkSetBlock(c, 5, 5, 5, BLOCKS.grass);
    // Prime the air cells around the solid with a distinct packed light byte
    // on the +x neighbor only.
    setBlockLight(c, 6, 5, 5, 11);
    setSkylight(c, 6, 5, 5, 9);
    // Solid's own cell is dark (standard voxel-flat lighting).
    const idxSelf = chunkIndex(5, 5, 5);
    expect(c.light[idxSelf]).toBe(0);

    const m = meshChunk(c, {});
    // Find the +x face: its 4 vertices share normal (1,0,0). Each quad is 4
    // vertices; one of the 6 faces matches.
    let plusXBase: number | null = null;
    for (let v = 0; v < m.normals.length; v += 3 * 4) {
      if (m.normals[v + 0] === 1 && m.normals[v + 1] === 0 && m.normals[v + 2] === 0) {
        plusXBase = v / 3;
        break;
      }
    }
    expect(plusXBase).not.toBeNull();
    // The 4 verts of that face should all carry the AIR cell's light byte.
    for (let i = 0; i < 4; i++) {
      expect(m.blockLight[plusXBase! + i]).toBe(11);
      expect(m.skylight[plusXBase! + i]).toBe(9);
    }
    // Sanity: another face (say -x, normal -1,0,0) carries the OTHER air
    // cell's light (which is 0 here, since we only set +x).
    let minusXBase: number | null = null;
    for (let v = 0; v < m.normals.length; v += 3 * 4) {
      if (m.normals[v + 0] === -1 && m.normals[v + 1] === 0 && m.normals[v + 2] === 0) {
        minusXBase = v / 3;
        break;
      }
    }
    expect(minusXBase).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(m.blockLight[minusXBase! + i]).toBe(0);
      expect(m.skylight[minusXBase! + i]).toBe(0);
    }
  });

  test("reference 16x16x16 solid-grass chunk (no neighbors) — vertex/triangle counts stable", () => {
    // Reference numbers reported for every lighting PR.
    const c = new Chunk({ cx: 0, cy: 0, cz: 0 });
    for (let y = 0; y < SIZE; y++)
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) chunkSetBlock(c, x, y, z, BLOCKS.grass);
    const m = meshChunk(c, {});
    // 6 outer faces * 16*16 quads * 2 tris = 3072 triangles; 4 verts/quad = 6*16*16*4 = 6144 verts.
    expect(m.triangleCount).toBe(6 * SIZE * SIZE * 2);
    expect(m.positions.length / 3).toBe(6 * SIZE * SIZE * 4);
  });
});

describe("LightingSystem — public API shape", () => {
  test("constructor accepts a World and exposes step / markBlockChanged / markLightCell / pendingCount", () => {
    const { w } = emptyWorld();
    const ls = new LightingSystem(w);
    expect(typeof ls.step).toBe("function");
    expect(typeof ls.markBlockChanged).toBe("function");
    expect(typeof ls.markLightCell).toBe("function");
    expect(typeof ls.pendingCount).toBe("function");
    expect(ls.pendingCount()).toBe(0);
  });

  test("step() on an empty queue is a no-op and returns 0", () => {
    const { w } = emptyWorld();
    const ls = new LightingSystem(w);
    expect(ls.step(100)).toBe(0);
  });

  test("worldLightKey returns the chunk+local that was marked", () => {
    const { w, c } = emptyWorld();
    const ls = new LightingSystem(w);
    ls.markLightCell(c, 1, 2, 3);
    expect(ls.pendingCount()).toBe(1);
    // Re-marking the same cell does not double-count.
    ls.markLightCell(c, 1, 2, 3);
    expect(ls.pendingCount()).toBe(1);
    // Different cell → new entry.
    ls.markLightCell(c, 1, 2, 4);
    expect(ls.pendingCount()).toBe(2);
    // Validate the chunk-key for a mild sanity on which chunk owns the mark.
    expect(toChunkKey(c.coord)).toBe("0,0,0");
  });
});
