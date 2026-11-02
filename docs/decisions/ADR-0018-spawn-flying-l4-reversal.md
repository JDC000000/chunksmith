# ADR-0018: SPAWN_FLYING reversed for L4 — spawn-on-grass as the right first impression
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** L3 widget (`PRD-L3.md` §Spawn), L4 widget retune (`docs/levels/level-4-day-1-handover.md`), ADR-0017 adjacent
**Decider:** `game-designer` subagent on Jon's "defer to game designer when I have questions" directive

## Context
L3's locked widget decision set `PHYSICS.SPAWN_FLYING = true`. Rationale at the time: L3 shipped on a superflat and later rolling-hills terrain where the player might spawn mid-air if the procedural surface moved under them before chunks finished streaming. Flight-mode-at-spawn avoided a jarring first-touch fall.

At L4 we add biomes with generated grass, forest, and mountain terrain. The spawn procedure (`revalidateSpawnHeight()` in `src/main.ts`) now scans the loaded world for the real surface after chunks prime, so the "spawn mid-air" case no longer exists.

Keeping `SPAWN_FLYING = true` at L4 means a new player's first impression is "floating above a forest" rather than "standing in a forest". The L4 theme is "the world has texture" — texture is sold by walking into it, not by hovering above it.

## Decision
**`PHYSICS.SPAWN_FLYING` flipped from `true` to `false` for L4.**

The player spawns standing on terrain. The L3 `revalidateSpawnHeight()` scan guarantees the spawn block is solid-with-air-above. Flight remains available via `F` (toggle) at any time; the controls-hint toast already names it.

## Consequences
**Positive**
- Walking into a biome is the correct L4 first impression — "the world has texture" sells itself
- Spawn-on-grass is the single most-copied screencap in the voxel-sandbox genre; defaulting to it maximizes shareability
- `F` toggle remains discoverable from the first-boot toast; flight-mode is a 1-keypress away for players who want it

**Negative**
- Players who liked L3's "float above and look around" first touch will need to press `F` once
- A player who spawns at the edge of a mountain cliff may walk off before pressing `F` — mitigated by the 5-block safe-y offset in `revalidateSpawnHeight()` and by the fact that falling itself is now a mechanical experience (gravity + collision are correct per ADR-0005)

## Rejected alternatives
### Keep `SPAWN_FLYING = true` at L4
Pros: no reversal; L3 behavior unchanged.
Cons: hovering-above-forest reads as a bug the first time a tester opens the game. Rejected.

### Flip only when a `BIOMES` namespace detects non-trivial terrain
Pros: smart-default; keeps flight for flat-world debug builds.
Cons: branching startup behavior = harder to playtest; a config toggle is simpler. Rejected.

### Add a `?fly=1` URL param override
Pros: dev-ergonomic.
Cons: separate concern. If needed, add later without changing this ADR. Not rejected per se — deferred.

## Verification
- `design/config.ts` `PHYSICS.SPAWN_FLYING = false` (verified post-edit)
- L3 e2e tests that depend on the player NOT falling at spawn (if any) will need to be adapted to initialize `window.__game.physicsState.flying = true` before probing — flagged for the Day L4-7 integration verification pass
- A manual playtest at L4-SHIP will confirm the first-touch feel

## Cost of change
Reverting to `true`: single-line edit in `design/config.ts`. No code-structure change. The `F` toggle remains the player-facing control either way.
