// Step-up logic for the player. Called by physics.ts after a horizontal sweep
// has clipped against a wall: if the obstacle is ≤ stepUpBlocks tall and the
// lifted AABB has clearance, slide the player up onto the ledge.
//
// Kept separate from collision.ts so sweepPlayer stays a pure swept-AABB primitive
// — step-up is a game-feel concern, not a collision law.

import type { World } from "../world/World";
import { isSolid } from "../world/blocks";
import type { Vec3 } from "./collision";

export interface StepUpInput {
  world: World;
  /** Where the swept position landed (after collision clipping). */
  position: Vec3;
  /** Horizontal velocity pre-clip. Used to short-circuit when motionless. */
  horizontalVelocity: Vec3;
  halfWidth: number;
  height: number;
  /** From PLAYER.STEP_UP_BLOCKS. L3 ships this at 1. */
  stepUpBlocks: number;
}

export interface StepUpResult {
  position: Vec3;
  stepped: boolean;
}

/** Tiny forward offset used to probe for an above-the-ledge wall. After a
 *  horizontal clip the AABB rests exactly on the wall's face (zero overlap
 *  into the wall column); nudging by this amount in the direction of the
 *  attempted motion makes the AABB bite into that column, so a solid at the
 *  lifted height reveals a wall taller than stepUpBlocks. */
const FORWARD_PROBE_EPS = 1e-3;

/**
 * Attempts to lift the player by stepUpBlocks. Returns stepped=true only if:
 *   (a) the lifted AABB at the current x/z has no overlap (head clearance), AND
 *   (b) the lifted AABB nudged a hair in the direction of motion also has no
 *       overlap (confirms the wall is ≤ stepUpBlocks tall, not just that there's
 *       a ceiling pocket above).
 * On stepped=false the input position is returned verbatim.
 */
export function tryStepUp(input: StepUpInput): StepUpResult {
  const { world, position, horizontalVelocity, halfWidth: hw, height: h, stepUpBlocks } = input;

  // No point stepping if the player wasn't trying to move horizontally.
  const vmag = Math.hypot(horizontalVelocity.x, horizontalVelocity.z);
  if (vmag === 0) {
    return { position, stepped: false };
  }

  const candidate: Vec3 = {
    x: position.x,
    y: position.y + stepUpBlocks,
    z: position.z,
  };

  // (a) Head/body clearance at the lifted spot.
  if (aabbOverlapsSolid(world, candidate, hw, h)) {
    return { position, stepped: false };
  }

  // (b) Nudge-forward probe. A 2-high wall shows up here because the clipped
  // AABB sits with its leading face flush against the wall's x boundary.
  const nudged: Vec3 = {
    x: candidate.x + (horizontalVelocity.x / vmag) * FORWARD_PROBE_EPS,
    y: candidate.y,
    z: candidate.z + (horizontalVelocity.z / vmag) * FORWARD_PROBE_EPS,
  };
  if (aabbOverlapsSolid(world, nudged, hw, h)) {
    return { position, stepped: false };
  }

  return { position: candidate, stepped: true };
}

/** Does the AABB at `pos` intersect any solid voxel? Same cell-span rules as collision.ts. */
function aabbOverlapsSolid(world: World, pos: Vec3, hw: number, h: number): boolean {
  const x0 = Math.floor(pos.x - hw);
  const x1 = Math.ceil(pos.x + hw) - 1;
  const y0 = Math.floor(pos.y);
  const y1 = Math.ceil(pos.y + h) - 1;
  const z0 = Math.floor(pos.z - hw);
  const z1 = Math.ceil(pos.z + hw) - 1;
  for (let cx = x0; cx <= x1; cx++) {
    for (let cy = y0; cy <= y1; cy++) {
      for (let cz = z0; cz <= z1; cz++) {
        if (isSolid(world.getBlock(cx, cy, cz))) return true;
      }
    }
  }
  return false;
}
