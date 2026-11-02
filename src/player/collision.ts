// Swept-AABB vs voxel grid. Pure function; no three.js, no Date, no Math.random.
// Caller applies gravity to velocity.y BEFORE calling sweepPlayer — we accept the
// already-updated velocity and clip against the world axis-by-axis.
//
// Axis order is X → Z → Y so that Y sweeps last. Why Y last: the step-up pass
// (src/player/stepUp.ts) can detect a 1-block ledge and lift the player before
// the next frame, without the current-frame vertical motion masking the clip.
//
// Grid convention: block at (bx,by,bz) occupies the unit cube
//   [bx,bx+1] × [by,by+1] × [bz,bz+1].
// Player AABB:
//   x in [pos.x-hw, pos.x+hw]
//   z in [pos.z-hw, pos.z+hw]
//   y in [pos.y, pos.y+h]           (feet at pos.y, head at pos.y+h)
//
// Cells overlapped by an AABB range [a,b]:
//   first = floor(a), last = ceil(b) - 1. Boundary-touching (b==ceil(b)) does
//   NOT count as overlap — the AABB has zero volume in that next cell.

import type { World } from "../world/World";
import { isSolid } from "../world/blocks";

export interface Vec3 { x: number; y: number; z: number; }

export interface SweepInput {
  world: World;
  /** AABB center on x/z, feet (bottom) on y. */
  position: Vec3;
  /** Meters/second. Gravity + jump impulse already applied by the caller. */
  velocity: Vec3;
  /** AABB_WIDTH_BLOCKS / 2. */
  halfWidth: number;
  /** AABB_HEIGHT_BLOCKS. */
  height: number;
  /** Seconds this frame. */
  dt: number;
}

export interface SweepResult {
  /** Position after sweep + clipping. */
  position: Vec3;
  /** Velocity after clipping — axes that hit become 0. */
  velocity: Vec3;
  /** AABB bottom resting on a solid within 0.05m. */
  grounded: boolean;
  /** Which axes had their motion clipped this frame. */
  collided: { x: boolean; y: boolean; z: boolean };
}

/** Vertical distance below the AABB bottom to probe for the "resting on solid" test. */
const GROUND_EPS = 0.05;

export function sweepPlayer(input: SweepInput): SweepResult {
  const { world, halfWidth: hw, height: h, dt } = input;
  const pos: Vec3 = { x: input.position.x, y: input.position.y, z: input.position.z };
  const vel: Vec3 = { x: input.velocity.x, y: input.velocity.y, z: input.velocity.z };
  const collided = { x: false, y: false, z: false };

  sweepAxisX(world, pos, vel, hw, h, dt, collided);
  sweepAxisZ(world, pos, vel, hw, h, dt, collided);
  sweepAxisY(world, pos, vel, hw, h, dt, collided);

  const grounded = isGrounded(world, pos, hw);

  return { position: pos, velocity: vel, grounded, collided };
}

/** True iff any solid voxel in the x/y/z cell cube overlaps the player's x/z footprint. */
function columnXHasSolid(
  world: World,
  cx: number,
  y0: number, y1: number,
  z0: number, z1: number,
): boolean {
  for (let cy = y0; cy <= y1; cy++) {
    for (let cz = z0; cz <= z1; cz++) {
      if (isSolid(world.getBlock(cx, cy, cz))) return true;
    }
  }
  return false;
}

function columnZHasSolid(
  world: World,
  cz: number,
  x0: number, x1: number,
  y0: number, y1: number,
): boolean {
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      if (isSolid(world.getBlock(cx, cy, cz))) return true;
    }
  }
  return false;
}

function planeYHasSolid(
  world: World,
  cy: number,
  x0: number, x1: number,
  z0: number, z1: number,
): boolean {
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      if (isSolid(world.getBlock(cx, cy, cz))) return true;
    }
  }
  return false;
}

function sweepAxisX(
  world: World,
  pos: Vec3,
  vel: Vec3,
  hw: number, h: number, dt: number,
  collided: { x: boolean; y: boolean; z: boolean },
): void {
  const dx = vel.x * dt;
  if (dx === 0) return;
  const newX = pos.x + dx;
  const z0 = Math.floor(pos.z - hw);
  const z1 = Math.ceil(pos.z + hw) - 1;
  const y0 = Math.floor(pos.y);
  const y1 = Math.ceil(pos.y + h) - 1;

  if (dx > 0) {
    // Right-moving: scan from the first cell past the current right edge out to
    // the last cell overlapped by the new AABB.
    const scanFrom = Math.ceil(pos.x + hw);
    const scanTo = Math.ceil(newX + hw) - 1;
    for (let cx = scanFrom; cx <= scanTo; cx++) {
      if (columnXHasSolid(world, cx, y0, y1, z0, z1)) {
        pos.x = cx - hw;
        vel.x = 0;
        collided.x = true;
        return;
      }
    }
  } else {
    // Left-moving: scan from the first cell past the current left edge out to
    // the first (farthest-left) cell overlapped by the new AABB.
    const scanFrom = Math.floor(pos.x - hw) - 1;
    const scanTo = Math.floor(newX - hw);
    for (let cx = scanFrom; cx >= scanTo; cx--) {
      if (columnXHasSolid(world, cx, y0, y1, z0, z1)) {
        pos.x = (cx + 1) + hw;
        vel.x = 0;
        collided.x = true;
        return;
      }
    }
  }
  pos.x = newX;
}

function sweepAxisZ(
  world: World,
  pos: Vec3,
  vel: Vec3,
  hw: number, h: number, dt: number,
  collided: { x: boolean; y: boolean; z: boolean },
): void {
  const dz = vel.z * dt;
  if (dz === 0) return;
  const newZ = pos.z + dz;
  // Note: pos.x has already been swept, so x cells reflect the post-X-clip AABB.
  const x0 = Math.floor(pos.x - hw);
  const x1 = Math.ceil(pos.x + hw) - 1;
  const y0 = Math.floor(pos.y);
  const y1 = Math.ceil(pos.y + h) - 1;

  if (dz > 0) {
    const scanFrom = Math.ceil(pos.z + hw);
    const scanTo = Math.ceil(newZ + hw) - 1;
    for (let cz = scanFrom; cz <= scanTo; cz++) {
      if (columnZHasSolid(world, cz, x0, x1, y0, y1)) {
        pos.z = cz - hw;
        vel.z = 0;
        collided.z = true;
        return;
      }
    }
  } else {
    const scanFrom = Math.floor(pos.z - hw) - 1;
    const scanTo = Math.floor(newZ - hw);
    for (let cz = scanFrom; cz >= scanTo; cz--) {
      if (columnZHasSolid(world, cz, x0, x1, y0, y1)) {
        pos.z = (cz + 1) + hw;
        vel.z = 0;
        collided.z = true;
        return;
      }
    }
  }
  pos.z = newZ;
}

function sweepAxisY(
  world: World,
  pos: Vec3,
  vel: Vec3,
  hw: number, h: number, dt: number,
  collided: { x: boolean; y: boolean; z: boolean },
): void {
  const dy = vel.y * dt;
  if (dy === 0) return;
  const newY = pos.y + dy;
  const x0 = Math.floor(pos.x - hw);
  const x1 = Math.ceil(pos.x + hw) - 1;
  const z0 = Math.floor(pos.z - hw);
  const z1 = Math.ceil(pos.z + hw) - 1;

  if (dy > 0) {
    // Jumping/rising: clip the head.
    const scanFrom = Math.ceil(pos.y + h);
    const scanTo = Math.ceil(newY + h) - 1;
    for (let cy = scanFrom; cy <= scanTo; cy++) {
      if (planeYHasSolid(world, cy, x0, x1, z0, z1)) {
        pos.y = cy - h;
        vel.y = 0;
        collided.y = true;
        return;
      }
    }
  } else {
    // Falling: clip the feet.
    const scanFrom = Math.floor(pos.y) - 1;
    const scanTo = Math.floor(newY);
    for (let cy = scanFrom; cy >= scanTo; cy--) {
      if (planeYHasSolid(world, cy, x0, x1, z0, z1)) {
        pos.y = cy + 1;
        vel.y = 0;
        collided.y = true;
        return;
      }
    }
  }
  pos.y = newY;
}

function isGrounded(world: World, pos: Vec3, hw: number): boolean {
  const probeY = Math.floor(pos.y - GROUND_EPS);
  const x0 = Math.floor(pos.x - hw);
  const x1 = Math.ceil(pos.x + hw) - 1;
  const z0 = Math.floor(pos.z - hw);
  const z1 = Math.ceil(pos.z + hw) - 1;
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      if (isSolid(world.getBlock(cx, probeY, cz))) return true;
    }
  }
  return false;
}
