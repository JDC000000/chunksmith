# Chunksmith — Product Requirements Document (Level 3: Living World)
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Version:** 1.0
**Status:** Approved for L3 build (decisions locked via widget 2026-11-02)
**Companion:** `PRD.md` (L1+L2, unchanged), `TSD-L3.md`, `workplan-L3.md`

## 1. Vision
A world that feels alive: hills to climb, caves to find, your edits still there tomorrow, and the sun crossing the sky while you build.

## 2. Scope

### 2.1 Locked decisions (widget, 2026-11-02)
| Area | Decision | ADR |
|---|---|---|
| Terrain | Multi-octave simplex heightmap + 3D cave noise | ADR-0009 |
| Physics | Full swept-AABB + jump + step-up; Space toggles creative flight | ADR-0010 |
| Persistence | IndexedDB chunk-delta saves (only edited chunks persist; procedural regenerates from seed) | ADR-0011 |
| Day/night | 10-minute full cycle | ADR-0012 |

### 2.2 In scope (L3 ship)
- Hills + caves generated from seed (replaces L2 superflat)
- Gravity (32 m/s²), jump (impulse 9 m/s), swept-AABB collision vs voxel grid
- 1-block step-up slides smoothly (Y-last axis order)
- `Space` tap jumps; `Space` double-tap toggles creative flight (gravity off, free-move)
- Edits persist across tab close via IndexedDB (`idb-keyval`)
- Unedited chunks regenerate from seed on load (no full-world snapshot)
- Day/night cycle: 10-minute full loop; shader modulates ambient + sun intensity
- Night is visibly darker than day (contrast measurable in screenshot)
- All L1 + L2 user stories still pass (no regression)

### 2.3 Out of scope (deferred to L4+)
- Mobs, pathfinding, AI
- Biomes beyond "default rolling grass" (no desert/snow/ocean splits)
- Trees, structures, ores, dungeon decoration
- Water, lava, fluid simulation
- Audio (L4)
- Multiplayer / netcode transport (L5 — `applyBlockChange` already server-shaped)
- Mobile touch controls (L5)
- Head-bob, FOV slider, motion-sensitivity settings (L4 accessibility pass)

### 2.4 Hard non-goals (never)
- Mojang assets, textures, code, trademark
- "Minecraft", "MC", "Creeper", "Steve", "Enderman" anywhere in filenames, strings, comments
- Minors as a target audience
- Social features that could become harassment vectors

## 3. User Stories (acceptance = passing test)

| ID | Story | Acceptance test | Spec file |
|---|---|---|---|
| US-L3-01 | Terrain has hills + caves (not superflat) | Sample 1000 (x,z) heights from seed `E2E_SEED` → variance > 4 m²; sample 10000 cells in a 32³ region → ≥50 air cells below surface | `tests/unit/terrain.test.ts` |
| US-L3-02 | Player falls under gravity | Spawn at y=20 above a floor at y=0; after 1 s sim, player.vy ≈ -32 m/s (±0.5); after 3 s, grounded=true, y near floor | `tests/unit/physics.test.ts` |
| US-L3-03 | Player can jump 1 block | On ground, trigger jump; peak y - start y ∈ [1.0, 1.4] m; back on ground after ≤0.9 s | `tests/unit/physics.test.ts` |
| US-L3-04 | Player can step up a 1-block ledge | Walk +x into a single 1-block step with vel = (3, 0, 0); after sweep, player.y increased by 1.0 m, vel.x unchanged | `tests/unit/physics.test.ts` |
| US-L3-05 | Player walks on terrain without clipping | 10 s random walk on hills seed `E2E_SEED` → no frame has `|pos - clampedPos| > 0.01`; no tunneling at 60 FPS | `tests/e2e/walk.spec.ts` |
| US-L3-06 | Space toggles creative flight | Double-tap Space → `window.__game.player.flying === true` and gravity=0; double-tap again → flying=false and gravity restored | `tests/e2e/flight.spec.ts` |
| US-L3-07 | Saved worlds persist across tab close via IDB | Place 3 blocks → reload page → same 3 blocks present at same coords | `tests/e2e/persistence-idb.spec.ts` |
| US-L3-08 | Chunks regenerate from seed if not in IDB | New tab + same seed + no edits → identical terrain to previous session (hash of first 27 chunk voxels equal) | `tests/unit/regen.test.ts` |
| US-L3-09 | Day/night cycle completes in 10 min | Call `tick(dt)` for 600 s of simulated time → `timeOfDay` returns to initial value (±0.001) exactly once | `tests/unit/dayNight.test.ts` |
| US-L3-10 | Night is visibly darker than day | Playwright screenshot at `t=0.25` (noon) vs `t=0.75` (midnight) → mean luminance of noon frame > mean luminance of midnight frame by ≥40/255 | `tests/e2e/dayNight.spec.ts` |
| US-L3-11 | No L1/L2 regression | Full L1+L2 suite still green under new world + new physics | existing specs |

## 4. Scope gates

### 4.1 P0 bug definition (unchanged from L2)
Crash · data loss (lost edits) · controls unresponsive · visual corruption blocking play · security issue · fall-through-world · getting-stuck-in-geometry.

### 4.2 L3 ship gate (end of Week 4)
- All US-L3-01 through US-L3-11 pass on prod URL
- ≥5 external testers × 20 min each
- No P0 bugs in last 7 days
- Bundle ≤ 400 KB gzipped (headroom from 136 KB at L2 → +~260 KB for noise + physics + IDB)
- 60 FPS p50 on 2020 MacBook over 10 min walk including flight toggle
- Memory steady-state ≤ 400 MB after 10 min
- Playwright suite + Vitest suite green; `npx tsc --noEmit` clean

### 4.3 L4 entry gate
- ≥15 external testers × 30 min
- No P0 bugs in last 7 days
- L4 PRD + TSD drafted
- L3 retro committed

## 5. Risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | Golden-hash drift across machines when switching from superflat to multi-octave noise | H | H | Lock PRNG + noise channel order in TSD §Determinism; regenerate baselines once on CI image; version-tag the hash |
| 2 | Swept-AABB tunnels at low frame rates | M | H | Sub-step physics when `dt > 1/30`; unit test at v=100 m/s |
| 3 | IDB write storm as player edits fast | M | H | 5s debounced flush in requestIdleCallback (see ADR-0011) |
| 4 | Player gets stuck in generated terrain at spawn | M | H | Spawn routine samples surface height from heightmap, places player at `(0, h+2, 0)`; e2e test asserts spawn is in air with ground below |
| 5 | Day/night shader change breaks L2 screenshot baselines | H | M | Freeze cycle at `timeOfDay=0.5` (bright day) during e2e unless test opts in; regenerate baselines in `walk.spec.ts` |
| 6 | 3D cave noise carves spawn chunk → player falls | M | H | Mask caves above `y = heightmap(x,z) - 3` so they can't surface at spawn; test case |
| 7 | IDB quota exceeded on long sessions | L | M | Chunk-delta encoding keeps per-chunk payload ≤ 4 KB; alarm at 50 MB total → warn user, no overwrite |
| 8 | "While we're here, add trees" scope creep | H | M | Trees explicitly out-of-scope in §2.3; reviewer flags |
| 9 | Jump feel is wrong (floaty / stiff) on first pass | H | M | ADR-0010 locks 9 m/s / 32 m/s² for ship; Day L3-4 is a dedicated feel-tuning day; game-designer owns `design/config.ts` |
| 10 | `simplex-noise` v4 bundle bloat | L | L | Measured ~8 KB gz; well under 400 KB budget |

## 6. Constraints
- **Time:** Jon's attention: ~1 month calendar; ~80-160 focus hours spread across autonomous subagent sessions. Jon's own at-keyboard time is the scarce resource — target < 90 min/day on Chunksmith.
- **Budget:** no new paid services; `simplex-noise` + `idb-keyval` are free & permissive-licensed.
- **Legal:** CC0 or self-made assets only; `simplex-noise` is MIT; `idb-keyval` is Apache-2.0.
- **Platforms:** desktop Chrome/Edge/Firefox; mobile deferred to L5.
- **Must not regress:** L1 (`smoke`, `controls`, `perf`) and L2 (`streaming`, `interact`, `hotbar`, `persistence` [in-memory re-expressed via IDB], texture atlas) suites all green under L3 changes.

## 7. Dependencies
- `simplex-noise` v4.x (jwagner) — ~8 KB gz, deterministic
- `idb-keyval` ^6.x — ~1 KB gz, Promise-based wrapper over IndexedDB
- No other new runtime deps. Existing deps unchanged.

## 8. Open questions (surface, don't guess)
- Spawn point stability: should seed `DEMO_SEED` always spawn at the same (x,z)? Default: yes, `(0,0)`. Flagged for Day L3-1 confirm.
- Save slot UX: single implicit "world 0" for L3, or named-world picker? Default: single implicit world, button to wipe. Named worlds → L4.
- Flight max speed: 2× walk speed? Default yes (locked unless playtest says otherwise at L3-4).
- Head-bob + FOV slider: confirmed deferred to L4 accessibility pass.

## 9. Launch plan
- **Soft (L3-week-2 playtest):** Jon + 3 contacts × 20 min
- **Public (L3 ship, end of Week 4):** Jon's X with 90-sec screencap showing night falling and sunrise, build-in-public thread
- **Metrics:** CF analytics free tier, session timer in-app, Sentry free tier
