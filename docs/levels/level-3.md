# Chunksmith — Workplan Level 3 ("Living World")
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Scope:** `PRD-L3.md`, `TSD-L3.md`
**Projected effort:** 80-160 focus hours (subagent-time) over ~4 weeks (~1 month calendar). Jon's at-keyboard target: < 90 min/day.

Convention per day: **subagents · goal condition · acceptance test · parallel/serial**. Each `/goal` names (a) commands, (b) exit condition per command, (c) requirement to show output.

---

## Week 1 — Terrain + Physics foundations (Days L3-1 → L3-5)

### Day L3-1 (today) — Planning + Day-2 kickoff
- **Subagents:** `planner` (THIS doc + PRD-L3 + TSD-L3 + 4 ADRs)
- **Goal condition:** 7 docs committed in `docs/`; `npx tsc --noEmit` still clean (no `.ts` touched)
- **Acceptance:** `ls docs/PRD-L3.md docs/TSD-L3.md docs/levels/level-3.md docs/decisions/ADR-{0009,0010,0011,0012}-*.md` all return paths
- **Mode:** serial (one agent)
- **Jon time:** 10 min to review widget decisions + skim docs

### Day L3-2 — Parallel foundation triple
Three subagents on DISJOINT file scopes — zero merge conflict risk.

| Subagent | File scope | Deliverable |
|---|---|---|
| `terrain-generator` | `src/gen/terrain.ts`, `tests/unit/terrain.test.ts`, `tests/unit/terrain.golden.test.ts` | Multi-octave heightmap + 3D cave noise per TSD-L3 §2; golden hash locked; `simplex-noise` v4 added |
| `physics-dev` | `src/player/physics.ts`, `src/player/collision.ts` (extend), `tests/unit/physics.test.ts` | Swept-AABB sweep, gravity, jump impulse, step-up slide, flight toggle; constants read from `design/config.ts` |
| `voxel-engine-dev` | `src/persist/idbStore.ts`, `tests/unit/idbStore.test.ts` | `idb-keyval` added; load/save/wipe + 5s debounced flusher stub; NO wiring into World yet |

- **Goal condition (each):** `npm test <own test file>` passes · `npx tsc --noEmit` clean · agent reports LOC + test counts
- **Mode:** PARALLEL (3 agents, scope-guard enforces disjoint)
- **Jon time:** 15 min review of each agent's report; 0 min typing

### Day L3-3 — Integration + rewire main.ts
- **Subagents:** `voxel-engine-dev` (integrate IDB into `World.applyBlockChange`, wire `loadChunk` into `ChunkManager`); `qa-playtester` (regenerate Playwright baselines for `walk.spec.ts`, `interact.spec.ts` under new terrain)
- **Goal condition:** `main.ts` boots the new terrain generator; L2 tests all still pass with new baselines; `npm run e2e` green
- **Acceptance:** US-L2-01 through US-L2-06 pass against hills terrain (not just superflat); `tsc` clean; e2e screenshot regen diffs committed intentionally
- **Mode:** serial (integration must land before perf work)
- **Jon time:** 10 min to approve new screenshot baselines

### Day L3-4 — Gravity + jump feel + flight polish
- **Subagents:** `game-designer` (tunes `PHYSICS` constants in `design/config.ts`, 2-3 iterations); `physics-dev` (double-tap flight toggle input handling); `qa-playtester` (manual-feel checklist for Jon)
- **Goal condition:** US-L3-02, US-L3-03, US-L3-04, US-L3-06 all pass as Vitest/Playwright
- **Acceptance test:** jump apex ∈ [1.0, 1.4] m (`physics.test.ts`); flight toggle via Playwright double-tap (`flight.spec.ts`)
- **Mode:** serial (feel-tuning requires playtest after each tweak)
- **Jon time:** 20 min playtest + confirm feel vs expectation (biggest Jon-time day of Week 1)

### Day L3-5 — Week 1 playtest + commit
- **Subagents:** `qa-playtester` (10 min scripted playtest run); `reviewer` (banned-term grep, scope-guard sanity pass)
- **Goal condition:** full suite green; Jon's playtest OK; branch `l3-week-1` tagged
- **Acceptance:** all US-L3-01 through US-L3-06 passing on CI
- **Mode:** serial
- **Jon time:** 15 min playtest + 5 min commit tag

**Week 1 exit gate:** terrain + physics + flight all shipped behind a feature flag `?l3=1`. L2 default URL still unchanged.

---

## Week 2 — Persistence + Day/night (Days L3-6 → L3-10)

### Day L3-6 — IDB persistence end-to-end
- **Subagents:** `voxel-engine-dev` (promote the Day-2 stub to live path; wire `applyBlockChange` → mark dirty → debounced flush; `wipeWorld` dev button); `qa-playtester` (write `persistence-idb.spec.ts`)
- **Goal condition:** US-L3-07 (edit → reload → persist) + US-L3-08 (empty IDB regens from seed) both pass
- **Acceptance:** Playwright places 3 blocks, calls `page.reload()`, asserts same 3 blocks via `window.__game.world.getBlock()`
- **Mode:** serial
- **Jon time:** 10 min smoke test on his Mac (not just headless)

### Day L3-7 — Day/night cycle + shader
- **Subagents:** `shader-dev` (new agent spin — adds uniforms to `chunkMaterial`; writes `src/world/time.ts`); `game-designer` (tunes `WORLD_TIME` constants); `qa-playtester` (writes `dayNight.spec.ts` + `dayNight.test.ts`)
- **Goal condition:** US-L3-09 (tick 600 s → tOD returns to start) + US-L3-10 (midnight darker than noon by ≥40/255 mean luminance) both pass
- **Acceptance test:** screenshot luminance delta measured in Playwright
- **Mode:** parallel on disjoint scopes (shader vs test vs constants)
- **Jon time:** 10 min to eyeball the sunrise/sunset transitions

### Day L3-8 — Integration + perf regression
- **Subagents:** `perf-dev` (runs 10-min walk capture, histogram of physics tick + chunk-gen + IDB flush); `voxel-engine-dev` (any hotspot fixes it finds)
- **Goal condition:** physics tick p95 ≤ 1 ms; terrain gen p95 ≤ 100 ms; IDB flush p95 ≤ 100 ms; bundle ≤ 400 KB gz; 60 FPS p50 maintained
- **Acceptance:** `perf-l3.spec.ts` captures `window.__perf` and asserts p95 budgets
- **Mode:** serial
- **Jon time:** 5 min review of perf report

### Day L3-9 — Adversarial persistence test agent
- **Subagents:** `adversary-tester` (new agent spin, read-only — tries to break persistence: edit → reload → edit again → reload → wipe → reload → confirm initial seed restored; attempts quota overflow via 10k synthetic edits)
- **Goal condition:** 20 adversarial scenarios documented in `tests/e2e/persistence-adversarial.spec.ts`, all pass; any failure → P0 bug
- **Acceptance:** scenario suite green; IDB usage ≤ 50 MB after stress
- **Mode:** serial
- **Jon time:** 5 min to read the failure summary (hopefully empty)

### Day L3-10 — Week 2 playtest
- **Subagents:** `qa-playtester` (20 min scripted playtest including a day/night loop); `reviewer`
- **Goal condition:** full suite green; branch `l3-week-2` tagged; feature flag `?l3=1` can be flipped default
- **Acceptance:** all US-L3-01 through US-L3-11 passing (incl. no L1/L2 regression)
- **Mode:** serial
- **Jon time:** 20 min playtest + 10 min commit tag

**Week 2 exit gate:** all 11 user stories passing in CI. Not yet shipped to prod URL.

---

## Week 3 — Polish, debug, regression hardening (Days L3-11 → L3-15)

### Day L3-11 — Spawn safety + edge cases
- **Subagents:** `physics-dev` (spawn-is-in-air guarantee: sample heightmap at (0,0), place player at `h+2`; what if that cell is a cave ceiling?); `qa-playtester` (edge-case e2e)
- **Goal condition:** 10 random seeds × 10 spawns each → zero fall-through-world, zero stuck-in-geometry
- **Acceptance:** `tests/e2e/spawn.spec.ts` across seed matrix
- **Mode:** serial
- **Jon time:** 5 min review

### Day L3-12 — Fog + sky polish
- **Subagents:** `shader-dev` (linear fog tinted to sky color per TSD-L3 §7.3); `game-designer` (sky color curve tuning)
- **Goal condition:** chunk-edge pop no longer visible on `?l3=1`; screenshot approved by Jon
- **Acceptance:** Playwright screenshot comparison + Jon manual OK
- **Mode:** parallel
- **Jon time:** 10 min screenshot review

### Day L3-13 — Save-slot wipe UX + diagnostics overlay
- **Subagents:** `voxel-engine-dev` (dev-only "wipe world" button in debug overlay; show IDB usage); `qa-playtester` (wipe → reload → procedural restored test)
- **Goal condition:** overlay shows IDB bytes used + edit count; wipe button restores procedural
- **Acceptance:** `tests/e2e/wipe.spec.ts`
- **Mode:** serial
- **Jon time:** 5 min

### Day L3-14 — Regression hardening
- **Subagents:** `qa-playtester` (full matrix: 3 seeds × 3 scenarios × screenshots); `reviewer` (banned-term grep, no `Math.random` in `src/world`/`src/gen`/`src/player`, no `three` in `src/gen`)
- **Goal condition:** zero regression, zero banned term, zero scope violation
- **Acceptance:** `grep` scripts in `.claude/hooks/` all exit 0; full suite green
- **Mode:** serial
- **Jon time:** 10 min review

### Day L3-15 — Soft playtest with 3 external testers
- **Subagents:** `qa-playtester` (coordinates playtest sheet in `docs/playtest/L3-week-3.md`)
- **Goal condition:** 3 testers × 20 min each; feedback categorized into P0/P1/P2
- **Acceptance:** playtest doc committed with findings
- **Mode:** serial (humans)
- **Jon time:** 30 min to schedule + follow up with testers

**Week 3 exit gate:** no P0 bugs; ≤5 open P1s with triage; soft tester feedback captured.

---

## Week 4 — Ship + retro + L4 prep (Days L3-16 → L3-20)

### Day L3-16 — P1 fix sprint
- **Subagents:** varies by what Week-3 playtest surfaced (likely `game-designer` + `physics-dev`)
- **Goal condition:** all P1s from Week-3 playtest either fixed or explicitly deferred-with-reason to L4
- **Acceptance:** issue tracker (or inline notes) empty of P1s
- **Mode:** parallel where disjoint
- **Jon time:** 20 min triage

### Day L3-17 — Flip `?l3=1` → default
- **Subagents:** `voxel-engine-dev` (remove feature flag; L3 is now THE game); `reviewer`
- **Goal condition:** `main.ts` boots L3 world by default; L2 code deleted (not kept dual); full suite green under L3-as-default
- **Acceptance:** `grep -r "?l3=" src/` returns empty; all tests green
- **Mode:** serial
- **Jon time:** 10 min review of PR diff

### Day L3-18 — Prod deploy to CF Pages
- **Subagents:** `voxel-engine-dev` (bump version, push to `main` for CF Pages auto-deploy); `qa-playtester` (full Playwright suite against prod URL)
- **Goal condition:** `curl -I https://chunksmith.joncartwright00.workers.dev` returns 200; full e2e suite green against prod; COOP/COEP headers present
- **Acceptance:** CI run log attached
- **Mode:** serial
- **Jon time:** 10 min (click deploy OK in CF if interactive)

### Day L3-19 — Ship gate playtest
- **Subagents:** `qa-playtester` (coordinates ≥5 external testers × 20 min)
- **Goal condition:** 5 testers logged; no P0; feedback in `docs/playtest/L3-SHIP.md`
- **Acceptance:** playtest doc + prod screenshot
- **Mode:** serial (humans)
- **Jon time:** 45 min outreach + follow-up

### Day L3-20 — L3 retro + L4 PRD stub
- **Subagents:** `planner` (writes `docs/retros/L3-SHIP.md` + `docs/PRD-L4.md` stub with locked scope outline — mobs OR biomes OR audio choice flagged for widget)
- **Goal condition:** retro + L4 stub committed; L3 tagged `v0.3.0`
- **Acceptance:** files exist; `v0.3.0` git tag
- **Mode:** serial
- **Jon time:** 15 min retro skim + widget decision for L4 scope

**L3 ship gate (end of Week 4):** PRD-L3 §4.2 — all 11 user stories pass on prod URL; ≥5 testers × 20 min; no P0 in last 7 days; bundle ≤400 KB gz; 60 FPS p50; `tsc` clean.

---

## Parallel/serial legend
- **Parallel day:** multiple subagents work in one invocation across disjoint file scopes. Scope-guard hook blocks any out-of-scope edit.
- **Serial day:** one subagent per step; next step depends on last.
- **Jon time:** at-keyboard minutes for Jon that day (review, playtest, deploy clicks).

## Risks to the schedule (if any slip)
- Day L3-4 feel-tuning is the softest estimate — if Jon's gut says "floaty" after Day L3-5, add a Day L3-4b iteration before Week 2.
- Day L3-9 adversarial persistence may surface a real schema bug — budget +1 day for schema fix if `version` strategy needs change.
- External testers (Day L3-15, L3-19) are human-dependent. Start outreach in Week 2.

## Checkpoint summary
| Checkpoint | Day | Gate |
|---|---|---|
| Week 1 end | L3-5 | Terrain + physics + flight behind flag |
| Week 2 end | L3-10 | All 11 user stories green in CI |
| Week 3 end | L3-15 | Soft tester playtest, P0-free |
| L3 SHIP | L3-20 | Prod URL + ≥5 testers × 20 min |
