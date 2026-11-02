import { describe, test, expect } from "vitest";
import { World } from "../../src/world/World";
import { Chunk, setBlock } from "../../src/world/Chunk";
import { BLOCKS } from "../../src/world/blocks";
import { raycastVoxels } from "../../src/player/raycast";

const EPS = 1e-6;

/** Build a world with a single stone block at the given world coord. */
function worldWithStoneAt(wx: number, wy: number, wz: number): World {
  const w = new World("raycast-test");
  // Chunk coord via floor-div 16; local via mod-16 (wrapped positive).
  const cx = Math.floor(wx / 16);
  const cy = Math.floor(wy / 16);
  const cz = Math.floor(wz / 16);
  const lx = ((wx % 16) + 16) % 16;
  const ly = ((wy % 16) + 16) % 16;
  const lz = ((wz % 16) + 16) % 16;
  const chunk = new Chunk({ cx, cy, cz });
  setBlock(chunk, lx, ly, lz, BLOCKS.stone);
  w.setChunk(chunk);
  return w;
}

/** Normalize a Vec3 — tests build their own rays and must pass a unit dir. */
function norm(x: number, y: number, z: number) {
  const L = Math.hypot(x, y, z);
  return { x: x / L, y: y / L, z: z / L };
}

describe("raycastVoxels", () => {
  test("ray +x from (0,0,0) hits (5,0,0) with face -x at distance 5", () => {
    const w = worldWithStoneAt(5, 0, 0);
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 5, y: 0, z: 0 });
    expect(hit!.face).toBe("-x");
    expect(hit!.distance).toBeCloseTo(5, 6);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  test("maxDistance=3 against the same (5,0,0) block → null (reach honored)", () => {
    const w = worldWithStoneAt(5, 0, 0);
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 3);
    expect(hit).toBeNull();
  });

  test("all-air column → null", () => {
    const w = new World("empty");
    w.setChunk(new Chunk({ cx: 0, cy: 0, cz: 0 }));
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit).toBeNull();
  });

  test("ray +y from (0,-5,0) hits (0,0,0) with face -y at distance 5", () => {
    const w = worldWithStoneAt(0, 0, 0);
    // Also load the (0,-1,0) chunk so cells at y < 0 are proper (loaded) air.
    // Not strictly required — getBlock on unloaded returns air — but makes intent explicit.
    w.setChunk(new Chunk({ cx: 0, cy: -1, cz: 0 }));
    const hit = raycastVoxels(w, { x: 0, y: -5, z: 0 }, { x: 0, y: 1, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 0, y: 0, z: 0 });
    expect(hit!.face).toBe("-y");
    expect(hit!.distance).toBeCloseTo(5, 6);
    expect(hit!.normal).toEqual({ x: 0, y: -1, z: 0 });
  });

  test("ray -x from (10,0,0) hits (5,0,0) with face +x", () => {
    // Block cell (5,0,0) spans x∈[5,6); nearest face from +x is x=6, so distance = 10-6 = 4.
    const w = worldWithStoneAt(5, 0, 0);
    const hit = raycastVoxels(w, { x: 10, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 5, y: 0, z: 0 });
    expect(hit!.face).toBe("+x");
    expect(hit!.distance).toBeCloseTo(4, 6);
    expect(hit!.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  test("ray -y from (0,10,0) hits (0,0,0) with face +y", () => {
    const w = worldWithStoneAt(0, 0, 0);
    const hit = raycastVoxels(w, { x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }, 20);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 0, y: 0, z: 0 });
    expect(hit!.face).toBe("+y");
    // Block [0,1); nearest face from +y is y=1; distance = 10-1 = 9.
    expect(hit!.distance).toBeCloseTo(9, 6);
    expect(hit!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  test("ray +z from (5,0,-5) hits (5,0,0) with face -z", () => {
    const w = worldWithStoneAt(5, 0, 0);
    // Cells (5,0,-5)..(5,0,-1) live in chunk (0,0,-1); unloaded = air for getBlock.
    const hit = raycastVoxels(w, { x: 5, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 5, y: 0, z: 0 });
    expect(hit!.face).toBe("-z");
    expect(hit!.distance).toBeCloseTo(5, 6);
    // Face -z → outward normal points in -z (points OUT of the hit face, away from the block).
    expect(hit!.normal).toEqual({ x: 0, y: 0, z: -1 });
  });

  test("diagonal ray (10,0,3) normalized from origin hits (5,0,1) via -x face", () => {
    // Hand-picked so the ray crosses z=1 (at x≈3.33) before any contested boundary,
    // then x=5 at z≈1.5 — well inside cell z=1. No corner tie.
    const w = worldWithStoneAt(5, 0, 1);
    // Load the slab chunk (0,0,0) covers all these cells.
    const dir = norm(10, 0, 3);
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, dir, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 5, y: 0, z: 1 });
    expect(hit!.face).toBe("-x");
    // Expected distance: tMaxX after 5 x-steps = 5 / dir.x = 5 / (10/√109) = √109/2 ≈ 5.2202.
    expect(hit!.distance).toBeCloseTo(Math.sqrt(109) / 2, 6);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  test("origin inside a solid cell returns distance 0", () => {
    const w = worldWithStoneAt(5, 0, 0);
    const hit = raycastVoxels(w, { x: 5.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: 5, y: 0, z: 0 });
    expect(hit!.distance).toBe(0);
    // Pragma: ray going +x — the "entry" face it came from is -x.
    expect(hit!.face).toBe("-x");
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  test("negative world coord: block at (-3,0,0), ray -x from (0,0,0) hits with face +x", () => {
    // Block cell (-3,0,0) lives in chunk (-1,0,0), local (13,0,0).
    const w = worldWithStoneAt(-3, 0, 0);
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.cell).toEqual({ x: -3, y: 0, z: 0 });
    expect(hit!.face).toBe("+x");
    // Block [-3,-2); nearest face from +x is x=-2; distance from origin 0 = 2.
    expect(hit!.distance).toBeCloseTo(2, 6);
    expect(hit!.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  test("distance returned is non-negative and within maxDistance when a hit is found", () => {
    const w = worldWithStoneAt(5, 0, 0);
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 6);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeGreaterThanOrEqual(0);
    expect(hit!.distance).toBeLessThanOrEqual(6 + EPS);
  });

  test("normal is a unit vector pointing OUT of the hit face", () => {
    const w = worldWithStoneAt(5, 0, 0);
    const hit = raycastVoxels(w, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    const n = hit!.normal;
    const len = Math.hypot(n.x, n.y, n.z);
    expect(len).toBeCloseTo(1, 10);
    // Face -x → outward normal is -x; so n·dir < 0 (pointing back toward the ray).
    const dot = n.x * 1 + n.y * 0 + n.z * 0;
    expect(dot).toBeLessThan(0);
  });
});
