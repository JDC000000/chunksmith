# ADR-0014: Block-light propagation — incremental dirty-queue BFS
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L4.md` §2.1 (widget 2), `docs/levels/level-4.md` Day L4-3
**Decider:** `game-designer` subagent on Jon's blanket "creative, contemporary, a bit fun" approval

## Context
L4 introduces lighting: skylight attenuates downward from open sky, torches emit block-light that propagates through air. Players need "place torch → the room lights up" to feel honest. Candidates:
- **(a) Full BFS flood each edit** — on every block change, flood all affected cells from scratch
- **(b) Incremental dirty-queue BFS** — maintain a persistent light grid; mark cells dirty on edit; walk only the dirty frontier each frame
- **(c) Greedy fixed-radius approximation** — ignore walls; compute `max(sky, torch - distance)` in a radius sphere

## Decision
**(b) Incremental dirty-queue.** A per-chunk `Uint8Array` stores one byte per cell with skylight (high nibble) and torch-light (low nibble). An `applyBlockChange` of a light-emitter or light-blocker queues the cell as dirty; a per-frame budget pops cells from the dirty queue and propagates to neighbors (6-way, falloff 1), re-enqueueing neighbors whose level changed.

Pseudocode (torch propagation):
```
queue = dirtyLightCells
budget = LIGHTING.DIRTY_QUEUE_BUDGET_PER_FRAME
while queue.length && budget-- > 0:
  cell = queue.shift()
  for each 6-neighbor n:
    if n is solid: continue
    newLevel = max(0, cell.torchLight - FALLOFF_PER_BLOCK)
    if n.torchLight < newLevel:
      n.torchLight = newLevel
      queue.push(n)
```

Config under `LIGHTING` namespace:
- `TORCH_LIGHT_LEVEL = 14`, `SUNLIGHT_LEVEL_MAX = 15`, `FALLOFF_PER_BLOCK = 1`
- `DIRTY_QUEUE_BUDGET_PER_FRAME = 2000` — keeps a cascade under 4 ms on mid hardware
- `TORCH_BRIGHTNESS_MIN = 0.4` — floor to avoid harsh dark regions in otherwise-lit rooms
- `TORCH_FLICKER_HZ = 5.5`, `TORCH_FLICKER_AMPLITUDE = 0.06` — live-flame feel in the fragment shader (ADR-0017)

## Consequences
**Positive**
- Honest cave feel: light does not pass through walls (greedy fails this)
- Within frame budget by construction — cascades spread over multiple frames rather than stalling one
- Darkness propagation (break a torch) uses the same queue with a `removeLight` seed
- Per-chunk byte array is contiguous — serializes cleanly to IDB alongside `voxels` (same `chunk-delta` key)
- Scales to hundreds of torches without a cap

**Negative**
- An interrupted cascade can show "unfinished" lighting for 1-2 frames after a big change — visually tolerable; measured on worst-case 500-torch cave teardown
- The light byte doubles the per-chunk storage from 4 KB to 8 KB — within L4 IDB budgets

## Rejected alternatives
### (a) Full BFS flood each edit
Pros: simplest to reason about; always consistent.
Cons: a 500-torch cave edit stalls the frame for 60+ ms. Rejected (fails perf gate).

### (c) Greedy fixed-radius approximation
Pros: cheapest; no queue, no propagation.
Cons: ignores walls → cave screencaps die (torch lights the OTHER side of the wall). Rejected.

## Verification
Unit test `tests/unit/lighting.test.ts` (Day L4-3):
- Place torch in open air, step one frame, assert neighbor cell `torchLight === TORCH_LIGHT_LEVEL - 1`
- Place torch next to a solid wall, step 20 frames, assert cells behind wall remain `torchLight === 0`
- Break the torch after full propagation, step 20 frames, assert all cells restored to pre-torch state
- Skylight: open-air column y=70 is `SUNLIGHT_LEVEL_MAX`; cover with roof, step frames, assert attenuation

E2E test `tests/e2e/torchlight.spec.ts` (Day L4-4):
- Place torch at (10, 10, 10), screenshot the illuminated cave face
- Baseline mean luminance of lit vs unlit face ≥ 60/255 (US-L4-08)

## Cost of change
Changing per-frame budget: `LIGHTING.DIRTY_QUEUE_BUDGET_PER_FRAME`. Swapping to full-BFS: single algorithm swap in `src/world/lighting.ts`. Swapping to greedy: lose cave fidelity, same single-file swap.
