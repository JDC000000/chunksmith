// 3D DDA voxel raycast. Amanatides & Woo 1987 — see ADR-0005.
// Pure function: no three.js, no mutation, no Date.now, no Math.random.
// Caller normalizes `dir`; `maxDistance` comes from PLAYER.REACH_BLOCKS at the call site
// (never hard-coded here — this file is reach-agnostic).

import type { World } from "../world/World";
import type { BlockCoord } from "../world/types";
import { isSolid } from "../world/blocks";

export type Vec3 = { x: number; y: number; z: number };
export type Face = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export interface RaycastHit {
  /** Integer world coord of the hit block. */
  cell: BlockCoord;
  /** Which face the ray crossed to enter `cell`. */
  face: Face;
  /** World-unit distance from `origin` to the entry face. */
  distance: number;
  /** Unit vector pointing OUT of `face` (same sign as the face label). */
  normal: Vec3;
}

const FACE_NORMALS: Record<Face, Vec3> = {
  "+x": { x: 1, y: 0, z: 0 },
  "-x": { x: -1, y: 0, z: 0 },
  "+y": { x: 0, y: 1, z: 0 },
  "-y": { x: 0, y: -1, z: 0 },
  "+z": { x: 0, y: 0, z: 1 },
  "-z": { x: 0, y: 0, z: -1 },
};

/**
 * Cell-stepped voxel raycast. Returns the first solid cell the ray enters within
 * maxDistance, together with the face it crossed and the outward normal of that
 * face. Returns null if the ray exits maxDistance before hitting anything solid.
 *
 * Algorithm: Amanatides & Woo (1987). Per axis:
 *   step   = sign(dir)
 *   tDelta = |1 / dir|            (how far along the ray to traverse one cell)
 *   tMax   = distance along ray to the next cell boundary on that axis
 * Each iteration advances along the axis with the smallest tMax, which is the
 * next cell boundary the ray crosses.
 */
export function raycastVoxels(
  world: World,
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
): RaycastHit | null {
  let cx = Math.floor(origin.x);
  let cy = Math.floor(origin.y);
  let cz = Math.floor(origin.z);

  // Degenerate case: origin is already inside a solid cell. We return distance 0.
  // Pragma: pick the face the ray "came from" — opposite the dominant axis of dir.
  // This keeps hitToIntent sensible for a player somehow sitting inside a block
  // (e.g. spawn clipping): a break targets the cell, a place offsets away from dir.
  if (isSolid(world.getBlock(cx, cy, cz))) {
    const face = dominantEntryFace(dir);
    return {
      cell: { x: cx, y: cy, z: cz },
      face,
      distance: 0,
      normal: FACE_NORMALS[face],
    };
  }

  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);

  // A zero component means the ray never crosses that axis's boundaries.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  let tMaxX = initialTMax(origin.x, dir.x, cx);
  let tMaxY = initialTMax(origin.y, dir.y, cy);
  let tMaxZ = initialTMax(origin.z, dir.z, cz);

  // Safety: a non-zero dir on all axes can at worst take ~3*maxDistance iterations;
  // guard against pathological inputs so this loop can never run forever.
  const hardCap = Math.ceil(maxDistance * 3) + 8;
  for (let i = 0; i < hardCap; i++) {
    let distance: number;
    let face: Face;

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      distance = tMaxX;
      cx += stepX;
      // Entered the new cell from the face opposite the step direction.
      face = stepX > 0 ? "-x" : "+x";
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      distance = tMaxY;
      cy += stepY;
      face = stepY > 0 ? "-y" : "+y";
      tMaxY += tDeltaY;
    } else {
      distance = tMaxZ;
      cz += stepZ;
      face = stepZ > 0 ? "-z" : "+z";
      tMaxZ += tDeltaZ;
    }

    if (distance > maxDistance) return null;

    if (isSolid(world.getBlock(cx, cy, cz))) {
      return {
        cell: { x: cx, y: cy, z: cz },
        face,
        distance,
        normal: FACE_NORMALS[face],
      };
    }
  }

  return null;
}

/**
 * Distance along the ray to the next cell boundary on one axis.
 * For dir > 0 the next boundary is at floor(origin) + 1; for dir < 0 it's floor(origin).
 * For dir == 0 the ray never crosses on this axis, so return Infinity.
 */
function initialTMax(originAxis: number, dirAxis: number, cellAxis: number): number {
  if (dirAxis > 0) return (cellAxis + 1 - originAxis) / dirAxis;
  if (dirAxis < 0) return (cellAxis - originAxis) / dirAxis;
  return Infinity;
}

/**
 * For an origin-in-solid return, pick the face the ray would have entered through
 * if it had come from outside — opposite the dominant axis of dir. Deterministic:
 * ties resolve x > y > z, with +/- chosen by sign(dir[axis]).
 */
function dominantEntryFace(dir: Vec3): Face {
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ax >= ay && ax >= az) return dir.x >= 0 ? "-x" : "+x";
  if (ay >= az) return dir.y >= 0 ? "-y" : "+y";
  return dir.z >= 0 ? "-z" : "+z";
}
