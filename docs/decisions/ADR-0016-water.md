# ADR-0016: Water — cosmetic translucent voxel at L4
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L4.md` §2.1 (widget 4), `docs/levels/level-4.md` Day L4-6
**Decider:** `game-designer` subagent on Jon's blanket "creative, contemporary, a bit fun" approval

## Context
L4 adds new block types. Water was the open question: fluid simulation vs cosmetic placeholder vs deferred entirely. Fluid simulation at voxel scale is a large body of research (cellular automata, pressure solvers, flow networks); none of them cheap, none of them ship-at-L4. The question was whether to put ANY water in L4.

Candidates:
- **(a) Cosmetic voxel at L4** — a translucent, non-simulated block type with a subtle wave shader
- **(b) Defer to L5 entirely** — no water block in L4

## Decision
**(a) Cosmetic voxel at L4.** A new `BLOCKS.water` block type with:
- Translucent rendering (`OPACITY = 0.55`, tint `[0.22, 0.55, 0.62]`)
- A vertex-shader micro-wave on the top face (`WAVE_AMPLITUDE_BLOCKS = 0.03` at `WAVE_HZ = 0.4`)
- Physics treats it as air: no collision, no slowdown, no drowning
- No flow, no spread, no neighbor-interaction

Procedural generator places water in plains biome depressions below `WATER.SEA_LEVEL_Y = 32`. Players can place/break water voxels manually via the hotbar as with any other block.

Config under `WATER` namespace in `design/config.ts`.

## Consequences
**Positive**
- Delivers the "still pond at sunrise" screencap — the single prettiest shot L4 can produce
- Zero sim = zero perf risk; integrates into existing mesher as a transparent-face pass
- A player can dig a channel for aesthetic reasons; blocks adjacent to water do nothing special
- Trivial to extend to fluid sim at L5+ — just add neighbor-flow logic, data model unchanged

**Negative**
- Water doesn't flow — a player breaking the dam of a pond sees the water just sit there
- No drowning mechanic — swimming through solid water feels weightless and unrealistic
- Translucency pass adds a second mesh batch per chunk — small cost, but non-zero
- Transparent sorting is approximate (no per-fragment depth sort) — adjacent water voxels can show z-fighting at glancing angles

## Rejected alternatives
### (b) Defer to L5 entirely
Pros: no transparency complexity, no sorting issues.
Cons: "a forest, a mountain, a plain" without water is desert-brochure energy. L4's theme is "the world has texture" and water is one of the biggest texture levers available. Rejected.

### Full fluid simulation at L4
Pros: a dam you can break actually drains.
Cons: 10× the scope of the entire rest of L4; fails the ship bar. Rejected (reconsider at L5+).

## Verification
Unit test `tests/unit/water.test.ts` (Day L4-6):
- `WATER` block is defined with `isSolid === false`, `isTransparent === true`
- Collision pipeline treats `WATER` like `AIR` (no clip, no slowdown)
- Procedural generator places water in plains cells with `height < SEA_LEVEL_Y`

E2E test `tests/e2e/water.spec.ts` (Day L4-6):
- Spawn, find a water voxel in-world, walk into it — assert no collision event, assert camera remains at ground level
- Place water voxel at (10, 10, 10), screenshot — mean alpha of water pixels ≈ `OPACITY * 255 ± 10`

## Cost of change
Adding flow at L5: new `src/world/fluid.ts` module operates on water cells; data model (one `BLOCKS.water` id) unchanged. Changing opacity: `WATER.OPACITY` constant. Making water block collision: a 1-line change in `src/player/collision.ts`.
