# ADR-0013: Biome blending — noise-mixed weights
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L4.md` §2.1 (widget 1), `docs/levels/level-4.md` Day L4-2
**Decider:** `game-designer` subagent on Jon's blanket "creative, contemporary, a bit fun" approval

## Context
L4 introduces biomes (plains / forest / mountains). The widget on the table was HOW each world-cell picks its biome and HOW adjacent biomes blend. Candidates:
- **(a) Voronoi hard cells** — pick a center per cluster, nearest-center wins, hard edges
- **(b) Noise-mixed weights** — a 2D noise field assigns a soft weight per biome; blended surface across the overlap
- **(c) Heightmap-gradient transition bands** — biome is a function of altitude only; transitions are horizontal bands

## Decision
**(b) Noise-mixed weights.** A single low-frequency Simplex field `w(x, z)` divided into three bands determines the dominant biome; within a `TRANSITION_SOFTNESS_BLOCKS` band around each boundary, surface height is the weighted average of each biome's contribution.

Pseudocode:
```
w = noise2D(x * WEIGHT_NOISE_SCALE, z * WEIGHT_NOISE_SCALE)   // -1..1
if w < -0.33: biome = PLAINS, strength = clamp01((−0.33 − w) / softness)
elif w <  0.33: biome = FOREST, strength = clamp01(min(w+0.33, 0.33−w) / softness)
else:           biome = MOUNTAINS, strength = clamp01((w − 0.33) / softness)
blendedHeight = sum(biome_height[i] * weight[i])
```

Config under `BIOMES` namespace in `design/config.ts`:
- `WEIGHT_NOISE_SCALE = 1/256` — ~16-chunk patches, walkable in a session
- `TRANSITION_SOFTNESS_BLOCKS = 12` — ¾-chunk fade; soft but still a sense of place
- `FOREST_TREES_PER_CHUNK = 4`, `MOUNTAIN_HEIGHT_MULT = 2.4`, `PLAINS_ROUGHNESS = 0.35`, `SNOW_CAP_Y = 72`

## Consequences
**Positive**
- Soft, organic transitions sell the sunrise-at-biome-edge screencap
- Single scalar lever (`TRANSITION_SOFTNESS_BLOCKS`) tunes the whole blend without re-reading noise code
- Deterministic from `seed + (x, z)` — fits L5 netcode gate
- Adding a 4th biome at L5 is ~10 lines (new band + weight path), no refactor
- Shares the existing `simplex-noise` dep — zero new bundles

**Negative**
- A ridge between mountain and plain can read as "muddy" if `TRANSITION_SOFTNESS_BLOCKS` is set too wide — test US-L4-02 (`≤ 2 m delta on 8-neighbors`) sets the ceiling
- No sharp biome edges (desert-against-forest wall look); that's a Voronoi strength, deliberately not ours

## Rejected alternatives
### (a) Voronoi hard cells
Pros: iconic, screenshot-clean borders.
Cons: reads retro/boardgame. The L4 theme is "the world has texture" — a hard edge is the opposite. Rejected.

### (c) Heightmap-gradient bands
Pros: cheapest; biome is derived not stored.
Cons: all biomes-of-same-altitude look identical — a plain at y=50 anywhere is identical. Kills the "place" feel. Rejected.

## Verification
Unit test `tests/unit/biomes.test.ts` (Day L4-2):
- `biomeAt(seed, x, z)` deterministic across 10,000 random (x, z)
- No 1-block height cliff on 8-neighbors anywhere in a 128×128 sample (US-L4-02)
- Mean height of 1,000 random `MOUNTAINS` cells > mean height of 1,000 random `PLAINS` cells + 20 m (US-L4-04)
- `FOREST` cells have `trees_per_chunk === BIOMES.FOREST_TREES_PER_CHUNK ± 1` averaged over 100 chunks

## Cost of change
Changing `TRANSITION_SOFTNESS_BLOCKS` or biome bands: one constant in `design/config.ts`. Adding a 4th biome: new band + new weight path, no refactor. Swapping to Voronoi: full `biomeAt` rewrite + regenerate the L3 golden hash test.
