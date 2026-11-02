// Jump, step-up, and flying-mode tests for stepPhysics + tryStepUp.
// Full-tick orchestration (gravity + jump + sweep + step) lives in physics.ts;
// isolated step-up checks go through stepUp.ts directly.

import { describe, test, expect } from "vitest";
import { World } from "../../src/world/World";
import { Chunk, setBlock } from "../../src/world/Chunk";
import { BLOCKS } from "../../src/world/blocks";
import { stepPhysics } from "../../src/player/physics";
import type { PhysicsState } from "../../src/player/physics";
import { tryStepUp } from "../../src/player/stepUp";

/** Pre-create a 5x5x5-chunk region around origin and plop solids in. */
function makeWorld(solids: Array<[number, number, number]>): World {
  const w = new World("jump-test");
  const chunkMap = new Map<string, Chunk>();
  for (let cx = -2; cx <= 2; cx++) {
    for (let cy = -2; cy <= 2; cy++) {
      for (let cz = -2; cz <= 2; cz++) {
        const c = new Chunk({ cx, cy, cz });
        chunkMap.set(`${cx},${cy},${cz}`, c);
        w.setChunk(c);
      }
    }
  }
  for (const [x, y, z] of solids) {
    const cx = Math.floor(x / 16);
    const cy = Math.floor(y / 16);
    const cz = Math.floor(z / 16);
    const c = chunkMap.get(`${cx},${cy},${cz}`);
    if (!c) throw new Error(`makeWorld: block (${x},${y},${z}) out of pre-created region`);
    const lx = ((x % 16) + 16) % 16;
    const ly = ((y % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    setBlock(c, lx, ly, lz, BLOCKS.stone);
  }
  return w;
}

/** Floor cells at y=-1 covering x,z in [-4,4] — enough footprint for all tests here. */
function flatFloor(): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = [];
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      cells.push([x, -1, z]);
    }
  }
  return cells;
}

const CAM_FWD = { x: 1, y: 0, z: 0 };
const CAM_RIGHT = { x: 0, y: 0, z: 1 };

describe("stepPhysics — jump", () => {
  test("jump sets velocity.y to JUMP_VELOCITY when grounded", () => {
    const w = makeWorld(flatFloor());
    const state: PhysicsState = {
      position: { x: 0.5, y: 0, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      flying: false,
    };
    const next = stepPhysics({
      state,
      input: { forward: 0, right: 0, up: 0, jump: true },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1 / 60,
    });
    // Jump is applied AFTER gravity so velocity.y is exactly JUMP_VELOCITY this frame.
    expect(next.velocity.y).toBe(9);
    // One frame of upward motion leaves us off the ground.
    expect(next.grounded).toBe(false);
    expect(next.position.y).toBeGreaterThan(0);
  });

  test("jump input does nothing when airborne (grounded=false)", () => {
    const w = makeWorld(flatFloor());
    const state: PhysicsState = {
      position: { x: 0.5, y: 10, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      flying: false,
    };
    const next = stepPhysics({
      state,
      input: { forward: 0, right: 0, up: 0, jump: true },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1 / 60,
    });
    // Only gravity should act. vel.y = -gravity * dt (should NOT be the jump impulse).
    expect(next.velocity.y).toBeLessThan(0);
    expect(next.velocity.y).toBeGreaterThan(-1);
  });

  test("after a fall-to-land, the next jump works again", () => {
    const w = makeWorld(flatFloor());
    // Start airborne with downward velocity — one big dt lands us on the floor.
    const falling: PhysicsState = {
      position: { x: 0.5, y: 2, z: 0.5 },
      velocity: { x: 0, y: -10, z: 0 },
      grounded: false,
      flying: false,
    };
    const landed = stepPhysics({
      state: falling,
      input: { forward: 0, right: 0, up: 0, jump: false },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1,
    });
    expect(landed.grounded).toBe(true);
    expect(landed.velocity.y).toBe(0);
    // Re-jump.
    const jumped = stepPhysics({
      state: landed,
      input: { forward: 0, right: 0, up: 0, jump: true },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1 / 60,
    });
    expect(jumped.velocity.y).toBe(9);
  });

  test("gravity accumulates while falling; terminal velocity clamps the drop", () => {
    const w = makeWorld([]);  // nothing below — free fall forever
    let state: PhysicsState = {
      position: { x: 0.5, y: 20, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      flying: false,
    };
    // Fall for many ticks. Y velocity should asymptote to -50 (TERMINAL_VELOCITY).
    for (let i = 0; i < 200; i++) {
      state = stepPhysics({
        state,
        input: { forward: 0, right: 0, up: 0, jump: false },
        world: w,
        cameraForward: CAM_FWD,
        cameraRight: CAM_RIGHT,
        dt: 1 / 60,
      });
    }
    expect(state.velocity.y).toBe(-50);
  });

  test("flying mode: gravity bypassed, up input moves y freely", () => {
    const w = makeWorld([]);
    const state: PhysicsState = {
      position: { x: 0.5, y: 20, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      flying: true,
    };
    // No vertical input → no motion, no gravity.
    const hover = stepPhysics({
      state,
      input: { forward: 0, right: 0, up: 0, jump: false },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1,
    });
    expect(hover.position.y).toBe(20);
    expect(hover.velocity.y).toBe(0);
    // up=1 moves at MOVE_SPEED (5 m/s).
    const rising = stepPhysics({
      state,
      input: { forward: 0, right: 0, up: 1, jump: false },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1,
    });
    expect(rising.position.y).toBeCloseTo(25, 5);
  });

  test("WASD input drives horizontal motion along camera basis", () => {
    const w = makeWorld(flatFloor());
    const state: PhysicsState = {
      position: { x: 0.5, y: 0, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      flying: false,
    };
    const next = stepPhysics({
      state,
      input: { forward: 1, right: 0, up: 0, jump: false },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1,
    });
    // forward=1 along +x; MOVE_SPEED=5 so dx ~= 5 (minus any floor-collision friction, none here).
    expect(next.position.x).toBeCloseTo(5.5, 5);
    expect(next.position.z).toBe(0.5);
  });
});

describe("tryStepUp", () => {
  test("step-up slides over a 1-block wall when the top is clear", () => {
    // Floor at y=-1 everywhere, 1-block wall at (3, 0, 0).
    const w = makeWorld([...flatFloor(), [3, 0, 0]]);
    // Player clipped against the wall: pos.x = 3 - hw.
    const r = tryStepUp({
      world: w,
      position: { x: 2.7, y: 0, z: 0.5 },
      horizontalVelocity: { x: 5, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      stepUpBlocks: 1,
    });
    expect(r.stepped).toBe(true);
    expect(r.position.y).toBe(1);  // lifted exactly one block
    expect(r.position.x).toBe(2.7);
    expect(r.position.z).toBe(0.5);
  });

  test("step-up fails if a ceiling block above the ledge would collide with the head", () => {
    // 1-block wall at (3, 0, 0) with a ceiling block at (2, 2, 0) directly above the lifted AABB.
    // Lifted AABB at pos.y=1 spans y in [1, 2.8] → head overlaps cy=2.
    const w = makeWorld([...flatFloor(), [3, 0, 0], [2, 2, 0]]);
    const r = tryStepUp({
      world: w,
      position: { x: 2.7, y: 0, z: 0.5 },
      horizontalVelocity: { x: 5, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      stepUpBlocks: 1,
    });
    expect(r.stepped).toBe(false);
    expect(r.position.y).toBe(0);  // unchanged
  });

  test("step-up declines when the player has no horizontal motion", () => {
    const w = makeWorld([...flatFloor(), [3, 0, 0]]);
    const r = tryStepUp({
      world: w,
      position: { x: 2.7, y: 0, z: 0.5 },
      horizontalVelocity: { x: 0, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      stepUpBlocks: 1,
    });
    expect(r.stepped).toBe(false);
  });

  test("step-up fails when the ledge itself is solid where the player would land", () => {
    // Two-high wall: blocks at (3, 0, 0) AND (3, 1, 0). Lifted AABB (pos.x=2.7, hw=0.3)
    // x cells = [2, 3]; the lifted body overlaps (3, 1, 0) → stepped=false.
    const w = makeWorld([...flatFloor(), [3, 0, 0], [3, 1, 0]]);
    const r = tryStepUp({
      world: w,
      position: { x: 2.7, y: 0, z: 0.5 },
      horizontalVelocity: { x: 5, y: 0, z: 0 },
      halfWidth: 0.3,
      height: 1.8,
      stepUpBlocks: 1,
    });
    expect(r.stepped).toBe(false);
  });
});

describe("stepPhysics integrates step-up", () => {
  test("walking into a 1-block ledge auto-steps the player up", () => {
    // Floor at y=-1 + ledge at (3, 0, 0) + (3, 0, 1) + (3, 0, -1) (to accommodate hw=0.3).
    const w = makeWorld([...flatFloor(), [3, 0, 0], [3, 0, 1], [3, 0, -1]]);
    const state: PhysicsState = {
      position: { x: 2, y: 0, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      flying: false,
    };
    const next = stepPhysics({
      state,
      input: { forward: 1, right: 0, up: 0, jump: false },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1,
    });
    // Horizontal clip at pos.x = 3 - 0.3 = 2.7. Then step-up lifts y to 1.
    expect(next.position.y).toBe(1);
    expect(next.grounded).toBe(true);
  });

  test("walking into a 2-high wall does NOT step up (head would hit the top block)", () => {
    const w = makeWorld([
      ...flatFloor(),
      [3, 0, 0], [3, 0, 1], [3, 0, -1],
      [3, 1, 0], [3, 1, 1], [3, 1, -1],  // second-row wall
    ]);
    const state: PhysicsState = {
      position: { x: 2, y: 0, z: 0.5 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      flying: false,
    };
    const next = stepPhysics({
      state,
      input: { forward: 1, right: 0, up: 0, jump: false },
      world: w,
      cameraForward: CAM_FWD,
      cameraRight: CAM_RIGHT,
      dt: 1,
    });
    expect(next.position.y).toBe(0);
    expect(next.position.x).toBeCloseTo(2.7, 5);
  });
});
