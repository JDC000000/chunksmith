// Full physics tick: horizontal input → gravity + jump → sweep → step-up.
// The main loop calls stepPhysics once per frame; collision.ts and stepUp.ts
// stay pure helpers.
//
// All physics tuning (gravity, jump impulse, terminal velocity, step-up height,
// move speed, AABB dimensions) lives in design/config.ts (PLAYER + PHYSICS).

import { PLAYER, PHYSICS } from "../../design/config";
import type { World } from "../world/World";
import { sweepPlayer } from "./collision";
import type { Vec3 } from "./collision";
import { tryStepUp } from "./stepUp";

export interface PhysicsState {
  /** AABB center on x/z, feet (bottom) on y. */
  position: Vec3;
  /** m/s. Carries jump arc and lateral slide between frames. */
  velocity: Vec3;
  /** True if the AABB bottom is resting on a solid within 0.05m. */
  grounded: boolean;
  /** Creative-mode toggle: disables gravity and lets `input.up` move y freely. */
  flying: boolean;
}

export interface PhysicsInputs {
  /** forward/right/up ∈ [-1, 1]. jump is edge-triggered (true for THIS tick only). */
  forward: number;
  right: number;
  up: number;
  jump: boolean;
}

export interface PhysicsInput {
  state: PhysicsState;
  input: PhysicsInputs;
  world: World;
  /** World-space horizontal "right" unit vector derived from the camera yaw. */
  cameraRight: Vec3;
  /** World-space horizontal "forward" unit vector (y zeroed by caller). */
  cameraForward: Vec3;
  dt: number;
}

/**
 * Advance one physics tick. Returns a fresh state; does not mutate the input.
 *
 * Order:
 *   1. Build horizontal velocity from WASD + camera basis (clamped to |v|≤MOVE_SPEED).
 *   2. Apply gravity (or free `up` input in flying mode); clamp to terminal velocity.
 *   3. Jump: if the input bit is set AND we were grounded last tick, set vel.y = JUMP.
 *   4. Sweep the AABB through the voxel grid.
 *   5. If horizontal motion was clipped AND the sweep says we're grounded, attempt
 *      step-up and (on success) commit the lifted position.
 */
export function stepPhysics(p: PhysicsInput): PhysicsState {
  const { state, input, world, cameraRight, cameraForward, dt } = p;
  const hw = PLAYER.AABB_WIDTH_BLOCKS / 2;
  const h = PLAYER.AABB_HEIGHT_BLOCKS;

  // 1. Horizontal input velocity in world space.
  const rawX = cameraForward.x * input.forward + cameraRight.x * input.right;
  const rawZ = cameraForward.z * input.forward + cameraRight.z * input.right;
  // Normalize if WASD diagonals would exceed unit length.
  const mag = Math.hypot(rawX, rawZ);
  const normX = mag > 1 ? rawX / mag : rawX;
  const normZ = mag > 1 ? rawZ / mag : rawZ;

  const velocity: Vec3 = {
    x: normX * PLAYER.MOVE_SPEED_MPS,
    y: state.velocity.y,
    z: normZ * PLAYER.MOVE_SPEED_MPS,
  };

  // 2. Gravity + jump, or free vertical in flying mode.
  if (state.flying) {
    velocity.y = input.up * PLAYER.MOVE_SPEED_MPS;
  } else {
    velocity.y -= PHYSICS.GRAVITY_MPS2 * dt;
    if (velocity.y < -PHYSICS.TERMINAL_VELOCITY_MPS) velocity.y = -PHYSICS.TERMINAL_VELOCITY_MPS;
    // Jump AFTER gravity so the impulse is applied cleanly (no gravity debit this frame).
    if (input.jump && state.grounded) {
      velocity.y = PHYSICS.JUMP_VELOCITY_MPS;
    }
  }

  // 3-4. Sweep.
  const swept = sweepPlayer({
    world,
    position: state.position,
    velocity,
    halfWidth: hw,
    height: h,
    dt,
  });

  let finalPos = swept.position;
  const finalVel = swept.velocity;
  let grounded = swept.grounded;

  // 5. Step-up on horizontal clip, only when grounded (prevents mid-air laddering).
  if (!state.flying && (swept.collided.x || swept.collided.z) && swept.grounded) {
    const stepped = tryStepUp({
      world,
      position: swept.position,
      horizontalVelocity: { x: velocity.x, y: 0, z: velocity.z },
      halfWidth: hw,
      height: h,
      stepUpBlocks: PHYSICS.STEP_UP_BLOCKS,
    });
    if (stepped.stepped) {
      finalPos = stepped.position;
      // We're now sitting on top of the ledge.
      grounded = true;
    }
  }

  return {
    position: finalPos,
    velocity: finalVel,
    grounded,
    flying: state.flying,
  };
}
