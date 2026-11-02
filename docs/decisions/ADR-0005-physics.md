# ADR-0005: Physics — custom swept-AABB (not cannon-es, not Rapier)
**Status:** Accepted
**Date:** 2026-11-02

## Context
Chunksmith is a voxel sandbox. The player and (later) mobs collide with a world made of axis-aligned 1-m cubes. Picking a block to break/place is a ray into the same cube grid. We need (a) a swept collision step for the player each tick and (b) a cell-stepped raycast for the crosshair. Candidates: `cannon-es`, `@dimforge/rapier3d`, roll-our-own.

## Decision
**Custom swept-AABB vs voxel grid + 3D DDA (Amanatides & Woo 1987) raycast. No third-party physics engine.**

The code lives in `src/player/` (physics-dev's scope). Signatures:
```typescript
// src/player/collision.ts
export function sweepPlayer(
  world: World,
  pos: Vec3,       // AABB center at feet (y = bottom of player AABB)
  vel: Vec3,       // desired delta (dt-scaled)
  size: Vec3,      // player AABB half-extents from design/config.ts
): { newPos: Vec3; grounded: boolean; collisions: Axis[] };

// src/player/raycast.ts
export function raycastVoxels(
  world: World,
  origin: Vec3,
  dir: Vec3,       // normalized
  maxDistance: number, // PLAYER.REACH_BLOCKS
): { cell: BlockCoord; face: Face; distance: number } | null;
```

Collision sweeps axes X, Z, Y (Y last so a 1-block step-up slides). Grounded = AABB bottom within 0.05 m of a solid cell.

Raycast steps cell-by-cell in the voxel grid using Amanatides & Woo's algorithm — see [eecs.yorku.ca/~amana/research/grid.pdf](https://www.eecs.yorku.ca/~amana/research/grid.pdf). Returns first non-air cell plus which face was crossed.

## Consequences
**Positive**
- ~30 LOC each for sweep + DDA — total under 100 LOC physics code for L3
- Zero dependencies → bundle doesn't grow, no WASM init cost
- Perfectly suited to axis-aligned grids: no SAT, no manifold assembly, no broad-phase
- Deterministic and seedable (critical for L5 netcode)
- No marshalling cost into a WASM/C library

**Negative**
- No ragdolls, soft bodies, joints (we don't need them until L4+ mobs)
- Any future minecart / boat / water-current physics will need its own implementation
- Collision correctness is on us — unit tests must be thorough

## Rejected alternatives

### cannon-es
- Pros: pure JS, familiar API
- Cons: Three.js forum (pmndrs) describes it as "on life support — only minor fixes." General rigid-body engine optimized for arbitrary meshes; overkill for a cube grid. Would need a bespoke voxel-world collider anyway, so we'd end up with our DDA plus cannon's step. Rejected.

### @dimforge/rapier3d
- Pros: Rust → WASM, 5-10× faster than cannon on complex scenes
- Cons: WASM init, dedicated worker, marshalling cost per step. For a voxel grid where our custom code is already O(1) per axis sweep, the overhead is a net loss. Reconsider at L4 if we add minecarts/boats/ragdolls.

### Three.js Raycaster against chunk meshes
- Pros: builtin
- Cons: works against the rendered geometry, not the voxel data. Slower (mesh traversal vs cell-stepping). Loses face identity after greedy meshing merges faces. Rejected for block pick/place.

## Verification
Unit tests in `tests/unit/collision.test.ts` (Day 5) must cover:
- Swept AABB against a block at `(5,0,0)` with velocity +x — player stops at `x = 5 - AABB_WIDTH/2`
- Diagonal movement into a corner — only the colliding axis clips
- 1-block step-up slides smoothly (Y-last ordering)
- Grounded flips true when standing on a block, false in air
- No tunneling at speed = 100 m/s over `dt = 1/60`

Raycast tests in `tests/unit/raycast.test.ts` (Day 5):
- Known grid, known ray → known (cell, face, distance)
- Max reach honored
- Returns null when all cells to max reach are air

## Cost of change
If we add minecarts in L4: isolate their simulation to a `src/player/vehicles.ts` module and consider Rapier for ragdolls only. Core player collision stays as-is.
