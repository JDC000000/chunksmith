# ADR-0012: Day/night cycle — 10-minute loop with sun-angle shader
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L3.md` §2.1, `TSD-L3.md` §6, `TSD-L3.md` §7

## Context
L3 adds ambient life to the world: a day/night cycle so the world looks different at minute 3 vs minute 8. The scope is deliberately atmospheric, not mechanical — mobs that only spawn at night are L4, light-level block state is L4. L3 needs (a) a time-of-day scalar advancing per frame, (b) a sun direction derived from time, (c) a shader that modulates ambient + directional light so the player feels the transition, (d) a sky color that lerps between day and night. Length of cycle, formula for sun angle, and shader hooks are the open choices.

## Decision
**10-minute full cycle. Time-of-day scalar `t ∈ [0, 1)` where 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.**

Sun direction:
```
sunDir = normalize(vec3(cos(t * 2π), sin(t * 2π) * 0.9 + 0.1, 0.3))
```
The `*0.9 + 0.1` bias keeps the sun's Y-component in `[-0.8, 1.0]` — at midnight the sun is below the horizon but not degenerately `dot(normal, sunDir) = 0`. The constant `0.3` on Z provides a slight oblique angle so the sun doesn't travel directly over the player's head, which makes top faces more interestingly lit.

Shader adds four new uniforms to `chunkMaterial`:
```
uTimeOfDay (float), uSunDir (vec3), uSunColor (vec3), uAmbient (float), uSkyColor (vec3)
```
Lighting is `albedo * (uAmbient + max(0, dot(normal, uSunDir)) * uSunColor)`. Normals come cheap from face index.

Sky color lerps between `DAY_SKY = [0.52, 0.72, 1.0]` and `NIGHT_SKY = [0.03, 0.04, 0.12]`, driven by `daylight = clamp01(sin(t * 2π) * 0.5 + 0.5)`.

Time advances via a fixed-step `tickTime(state, dt)` in `src/world/time.ts`. `dt` is clamped identically to the physics tick so time flow is independent of frame rate hitches.

## Consequences
**Positive**
- 10 min is long enough to feel natural, short enough that a 20-min playtest sees multiple cycles
- Single scalar `t` is deterministic, pausable, warpable (dev console can set `window.__game.time.timeOfDay = 0.75` to trigger sunset instantly)
- Sun formula is a one-liner — easy to reason about, easy to test
- Shader cost is a dot product + a lerp — measured ≤ 0.5 ms/frame on a 2020 MacBook
- Clean decoupling: `TimeState` owns the scalar; the shader uniforms are a one-way read every frame
- Debug toggle "freeze time at noon" lets screenshot baselines stay stable (US-L3-10 asserts midnight-vs-noon by force-setting `t`, not by waiting 5 min)
- Netcode-ready: `t` would be server-authoritative at L5; it's a scalar, cheap to sync

**Negative**
- No weather, no clouds, no moon phase, no stars — all L4+ (deliberate)
- Fixed cycle length — can't be slowed/sped by game state (OK for L3; could parameterize at L4)
- Shader uniform add will dirty L2 screenshot baselines on first integration; regenerate once (Day L3-3, Day L3-7)
- Sun-direction formula is not astronomically correct — the sun does not rise exactly east. Not a goal

## Rejected alternatives

### 20-minute cycle
Pros: more time per phase of the day; closer to Minecraft's 20-min default.
Cons: 20 min playtests may see only one full cycle, so a tester may never see night. Rejected.

### 5-minute cycle
Pros: tester sees many cycles per playtest.
Cons: too fast — the sun visibly whips across the sky; motion-sensitive viewers report queasiness. Rejected.

### No day/night at L3 (defer to L4)
Pros: smaller L3 scope.
Cons: Jon locked day/night in the widget. Rejected.

### Hemispheric light with per-vertex color baking
Pros: cheapest shader.
Cons: can't react to `uTimeOfDay` without re-baking → doesn't actually animate. Rejected.

### Full PBR / physical sun with scattering (Rayleigh / Mie)
Pros: breathtaking.
Cons: shader cost blows the 0.5 ms budget; implementation complexity 10× the chosen path; voxel sandbox aesthetic doesn't need photorealism. Rejected.

### Variable-speed cycle (slower at dawn/dusk)
Pros: more time appreciating sunrise/sunset.
Cons: breaks determinism of "600 s = 1 cycle" test; makes US-L3-09 harder to express. Rejected (reconsider at L4 if desired).

## Verification
Unit test `tests/unit/dayNight.test.ts` (Day L3-7):
- Initial `t = 0.3`; call `tickTime(state, dt)` with `dt = 1/60` for `600 * 60` iterations → `t ≈ 0.3` within 1e-3 (one full cycle)
- `sunDir(t=0.5).y > 0.9` (noon, sun overhead)
- `sunDir(t=0.0).y < 0` (midnight, sun below horizon)
- `daylight(t=0.0) === 0`, `daylight(t=0.5) === 1`

E2E test `tests/e2e/dayNight.spec.ts` (Day L3-7):
- Set `window.__game.time.timeOfDay = 0.5`, screenshot
- Set `window.__game.time.timeOfDay = 0.0`, screenshot
- Mean luminance of noon frame ≥ mean luminance of midnight frame + 40/255

## Cost of change
Changing cycle length: one constant in `design/config.ts` (`WORLD_TIME.CYCLE_SECONDS`). Changing sun formula: one function in `src/world/time.ts` + one re-baseline for the midnight screenshot. Adding weather at L4: adds `WeatherState` next to `TimeState`, new shader uniforms, additive — no refactor of this ADR's shape.
