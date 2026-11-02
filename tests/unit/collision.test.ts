// Swept-AABB collision unit tests. Written FIRST per L3 TDD rule — these must
// fail before src/player/collision.ts exists, pass after.
// Grid convention: block at (bx,by,bz) occupies the unit cube [bx,bx+1]×[by,by+1]×[bz,bz+1].
// Player AABB: center on x/z, feet (bottom) on y, so AABB spans
//   [pos.x-hw, pos.x+hw] × [pos.z-hw, pos.z+hw] × [pos.y, pos.y+h].

import { describe, test, expect } from "vitest";
import { World } from "../../src/world/World";
import { Chunk, setBlock } from "../../src/world/Chunk";
import { BLOCKS } from "../../src/world/blocks";
import { sweepPlayer } from "../../src/player/collision";

/** Build a world pre-populated with chunks in a modest region around origin,
 *  plus any explicit solids. We don't need terrain — just the chunks loaded so
 *  World.getBlock returns air (not out-of-bounds) inside the sweep region. */
function makeWorld(solids: Array<[number, number, number]>): World {
  const w = new World("collision-test");
  // Pre-create chunks in a 3x3x3 region so sweeps near origin never read unloaded.
  const chunkMap = new Map<string, Chunk>();
  for (let cx = -2; cx <= 2; cx++) {
    for (let cy = -2; cy <= 2; cy++) {
      for (let cz = -2; cz <= 2; cz++) {
        const key = `${cx},${cy},${cz}`;
        const c = new Chunk({ cx, cy, cz });
        chunkMap.set(key, c);
        w.setChunk(c);
      }
    }
  }
  for (const [x, y, z] of solids) {
    const cx = Math.floor(x / 16);
    const cy = Math.floor(y / 16);
    const cz = Math.floor(z / 16);
    const key = `${cx},${cy},${cz}`;
    const c = chunkMap.get(key);
    if (!c) throw new Error(`makeWorld: solid at (${x},${y},${z}) outside pre-created chunk range`);
    const lx = ((x % 16) + 16) % 16;
    const ly = ((y % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    setBlock(c, lx, ly, lz, BLOCKS.stone);
  }
  return w;
}

describe("sweepPlayer", () => {
  test("AABB sweep against a block at (5,0,0) stops at x=4.5 (hw=0.5)", () => {
    // Player AABB center starts at x=2. hw=0.5 so right edge is at pos.x+0.5.
    // Block occupies x in [5,6]. Right edge touches the block's left face at pos.x=4.5.
    const w = makeWorld([[5, 0, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 2, y: 0.1, z: 0.5 },
      velocity: { x: 10, y: 0, z: 0 },
      halfWidth: 0.5,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.x).toBeCloseTo(4.5, 5);
    expect(r.velocity.x).toBe(0);
    expect(r.collided.x).toBe(true);
    expect(r.collided.y).toBe(false);
    expect(r.collided.z).toBe(false);
  });

  test("AABB sweep in -x against block at (-1,0,0) stops at x=0.5 (hw=0.5)", () => {
    // Block occupies x in [-1,0]. Left edge of player touches block's right face at pos.x=0.5.
    const w = makeWorld([[-1, 0, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 3, y: 0.1, z: 0.5 },
      velocity: { x: -10, y: 0, z: 0 },
      halfWidth: 0.5,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.x).toBeCloseTo(0.5, 5);
    expect(r.velocity.x).toBe(0);
    expect(r.collided.x).toBe(true);
  });

  test("Z sweep against block at (0,0,5) stops at z=4.5 (hw=0.5)", () => {
    const w = makeWorld([[0, 0, 5]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 0.1, z: 2 },
      velocity: { x: 0, y: 0, z: 10 },
      halfWidth: 0.5,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.z).toBeCloseTo(4.5, 5);
    expect(r.velocity.z).toBe(0);
    expect(r.collided.z).toBe(true);
  });

  test("falling onto block at (0,0,0) rests feet at y=1 and zeroes velocity.y", () => {
    const w = makeWorld([[0, 0, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 5, z: 0.5 },
      velocity: { x: 0, y: -20, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.y).toBeCloseTo(1, 5);
    expect(r.velocity.y).toBe(0);
    expect(r.collided.y).toBe(true);
    expect(r.grounded).toBe(true);
  });

  test("jumping into ceiling block at (0,3,0): head clips at pos.y = 3 - height", () => {
    // Head leading edge is pos.y + 1.8. Block at cy=3 means ceiling at y=3.
    // Clip so pos.y + 1.8 = 3 → pos.y = 1.2.
    const w = makeWorld([[0, 3, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 0.1, z: 0.5 },
      velocity: { x: 0, y: 10, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.y).toBeCloseTo(3 - 1.8, 5);
    expect(r.velocity.y).toBe(0);
    expect(r.collided.y).toBe(true);
  });

  test("no collision in open space: position advances by velocity*dt", () => {
    const w = makeWorld([]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 5, z: 0.5 },
      velocity: { x: 1, y: 0, z: 2 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 0.5,
    });
    expect(r.position.x).toBeCloseTo(1.0, 5);
    expect(r.position.y).toBe(5);
    expect(r.position.z).toBeCloseTo(1.5, 5);
    expect(r.collided.x).toBe(false);
    expect(r.collided.y).toBe(false);
    expect(r.collided.z).toBe(false);
  });

  test("diagonal: X clips first, then Z clips against a block aligned with the X-wall", () => {
    // (3,0,0) blocks +x motion. After X clip, player AABB x-range is [2,3] so x-cell = 2.
    // (2,0,3) sits at cx=2 which the clipped AABB still overlaps → Z sweep clips at z=2.5.
    const w = makeWorld([[3, 0, 0], [2, 0, 3]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 0.1, z: 0.5 },
      velocity: { x: 10, y: 0, z: 10 },
      halfWidth: 0.5,
      height: 1.8,
      dt: 1,
    });
    expect(r.collided.x).toBe(true);
    expect(r.collided.z).toBe(true);
    expect(r.position.x).toBeCloseTo(2.5, 5);
    expect(r.position.z).toBeCloseTo(2.5, 5);
  });

  test("tunneling prevention: dt=1 and vel.x=100 still stops at the wall", () => {
    // Would overshoot by ~95 blocks without a swept sweep.
    const w = makeWorld([[5, 0, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 2, y: 0.1, z: 0.5 },
      velocity: { x: 100, y: 0, z: 0 },
      halfWidth: 0.5,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.x).toBeCloseTo(4.5, 5);
    expect(r.velocity.x).toBe(0);
    expect(r.collided.x).toBe(true);
  });

  test("grounded is true when AABB bottom sits exactly on top of a block", () => {
    const w = makeWorld([[0, 0, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 1, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1 / 60,
    });
    expect(r.grounded).toBe(true);
  });

  test("grounded is false when AABB bottom is clearly above a solid", () => {
    // Feet 0.5m above the block top — well outside the 0.05m rest tolerance.
    const w = makeWorld([[0, 0, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 1.5, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1 / 60,
    });
    expect(r.grounded).toBe(false);
  });

  test("grounded is false in open air (no solids anywhere underneath)", () => {
    const w = makeWorld([]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 10, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1 / 60,
    });
    expect(r.grounded).toBe(false);
  });

  test("zero velocity: position and velocity are unchanged (no collision)", () => {
    const w = makeWorld([]);
    const r = sweepPlayer({
      world: w,
      position: { x: 1.5, y: 2.5, z: 3.5 },
      velocity: { x: 0, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1 / 60,
    });
    expect(r.position).toEqual({ x: 1.5, y: 2.5, z: 3.5 });
    expect(r.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(r.collided).toEqual({ x: false, y: false, z: false });
  });

  test("Y sweep is last: a +X push stopped by a wall still falls under gravity on Y", () => {
    // Wall at (3,0,0) is at the player's current y, so +X motion hits it.
    // Floor at (_, -1, _) lets the Y clip rest feet at y=0 after falling.
    const w = makeWorld([
      [3, 0, 0],
      [-1, -1, 0], [0, -1, 0], [1, -1, 0], [2, -1, 0], [3, -1, 0],
    ]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 0.1, z: 0.5 },
      velocity: { x: 20, y: -20, z: 0 },  // slam into wall and fall
      halfWidth: 0.5,
      height: 1.8,
      dt: 1,
    });
    // X clips at 3 - 0.5 = 2.5. Y clips onto floor at (_, -1, _) so feet rest at y=0.
    expect(r.position.x).toBeCloseTo(2.5, 5);
    expect(r.position.y).toBeCloseTo(0, 5);
    expect(r.collided.x).toBe(true);
    expect(r.collided.y).toBe(true);
    expect(r.grounded).toBe(true);
  });

  test("sideways sweep slides along a floor without touching Y (floor is below feet)", () => {
    // Walking along a floor: feet at y=0, block below at y=-1. Only X moves.
    const w = makeWorld([[0, -1, 0], [1, -1, 0], [2, -1, 0]]);
    const r = sweepPlayer({
      world: w,
      position: { x: 0.5, y: 0, z: 0.5 },
      velocity: { x: 1, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      dt: 1,
    });
    expect(r.position.x).toBeCloseTo(1.5, 5);
    expect(r.position.y).toBe(0);
    expect(r.collided.x).toBe(false);
    expect(r.grounded).toBe(true);
  });
});
