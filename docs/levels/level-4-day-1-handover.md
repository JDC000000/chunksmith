# L4 Day 1 handover — widget lock complete, re-tunes pending Jon's call

**Date:** 2026-11-02
**Status:** Widget decisions LOCKED (ADRs 0013-0017 accepted). Config namespaces added.

## What's done
- 5 ADRs written and committed: `docs/decisions/ADR-00{13..17}-*.md`
- `design/config.ts` has 4 new namespaces: `BIOMES`, `LIGHTING`, `INVENTORY`, `WATER` (~24 new constants)
- PRD-L4 §2.1 updated — widget decisions now show as LOCKED with ADR cross-refs
- Level-4.md Day L4-1 is now unblocked

## What the game-designer subagent ALSO proposed, but I did NOT apply

The game-designer recommended four re-tunes of **existing** L1-L3 constants. These change CURRENT L3 behavior, not just L4 feature behavior, so I did not apply them without Jon's explicit review. Jon's "I approve the choice" was blanket approval for the 5 L4 widget decisions — I treated it as scoped to new L4 constants, not reversals of locked L3 decisions.

| Constant | Current | Game-designer's proposed L4 value | Reason |
|---|---|---|---|
| `DAY_NIGHT.AMBIENT_FLOOR` | 0.35 | **0.18** | Night is too bright to notice torches. Drop floor so emissive channel earns its screen time. Also makes US-L4-08 (lit vs unlit ≥ 60/255 luminance delta) easier to pass. |
| `DAY_NIGHT.AMBIENT_RANGE` | 0.25 | **0.42** | Preserve day brightness (0.18 + 0.42 = 0.60 ≈ old 0.60 peak) while deepening night. Net: brighter days, darker nights, same noon. |
| `WORLD.VERTICAL_RADIUS_CHUNKS` | 4 | **6** | Mountains at `BIOMES.MOUNTAIN_HEIGHT_MULT = 2.4` need vertical headroom or peaks pop in. ~50% more vertical streaming — within L4 perf gate. |
| `PHYSICS.SPAWN_FLYING` | true | **false** | L4 spawns on actual terrain with trees; walking in is the correct first impression. Flight still 1 keypress away. |

### Jon's call to make before Day L4-2 kickoff
- Approve all 4 re-tunes → apply in one commit, bump L3 e2e baselines
- Approve a subset → apply those, note which ones for L5
- Reject → L4 ships with current L3 constants; game-designer re-visits at L4 Day 6 polish

Each re-tune is a one-line change in `design/config.ts`. The behavioral impact:
- Ambient re-tune → night cave screencaps go from "lit anyway" to "dark enough to need a torch"
- Vertical radius re-tune → mountain peaks visible from distance; adds streaming load
- Spawn flying re-tune → first-touch experience changes from "float above the world" to "walk forward on grass"

## Open items the game-designer handed back (not blocking Day L4-2)

1. **Hotbar growth** (PRD §8): `INVENTORY.HOTBAR_SLOTS` kept at 9. If L4 playtests show demand for 2 rows, flip to 18, no code refactor.
2. **4th biome:** 3 locked. A desert biome would be ~10 lines in `biomeAt()` given ADR-0013 (b)'s band-weight scheme.
3. **Water underfoot a11y:** full-screen blue tint when head is submerged. Tasteful if alpha-clamped. Deferred to Day L4-6 polish.

## New feel knobs the game-designer flagged as high-leverage

| Knob | Value | Why Jon should know about it |
|---|---|---|
| `LIGHTING.TORCH_FLICKER_HZ` + `TORCH_FLICKER_AMPLITUDE` | 5.5 Hz / 0.06 | A static torch is a prop; a flickering torch is a thing you want in your base. "The knob that makes someone come back." Clamp amplitude ≤ 0.1 before shipping (a11y + motion-sickness). |
| `BIOMES.TRANSITION_SOFTNESS_BLOCKS` | 12 | Single lever for the whole "soft blend vs map-line" vibe. Tunable without re-reading noise code. |
| `INVENTORY.OPEN_CLOSE_ANIM_MS` | 140 | The feel difference between "modern app" and "2013 Java game". Cheap, huge perceived-quality lift. |

## Verification
- `./scripts/legal-check.sh` → exit 0 (clean)
- `npx tsc --noEmit` → exit 0
- Existing suite still 171/171 unit + 26/26 e2e (no L1-L3 behavior change — new constants are additive)

## Next actions for Day L4-2 (biomes)
1. (Optional) Jon reviews the 4 re-tunes above and locks them in
2. `terrain-generator` subagent extends `src/gen/terrain.ts` with the biome weight function per ADR-0013
3. New tests: `tests/unit/biomes.test.ts` for US-L4-01..04
4. Golden hash for `terrainAt("chunksmith-dev-001", 0, 0, 0)` must be recomputed and locked in that test
