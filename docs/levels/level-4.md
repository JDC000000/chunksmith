# Level 4 — The World Has Texture (Days L4-1 → L4-7, then Week 2 ship)

**Ship target:** end of Week 2 of L4 (prod URL on Cloudflare Pages, L4-default).
**Companion:** `docs/PRD-L4.md`, `docs/TSD-L4.md` (to be drafted after Day L4-1 widget).

> This plan assumes widget decisions in `PRD-L4.md §2.1` lock on Day L4-1. Days L4-2 → L4-7 are **drafts** until the five candidate ADRs (0013–0017) accept.

## Scope
Three biomes (plains / forest / mountains) with smooth transitions. Per-block illumination byte driving skylight + torch light. 27-slot backpack UI with drag-and-drop and 64-stack blocks. 5–6 new block types (`log`, `leaves`, `torch`, `sand`, `snow`, and possibly `water`).

## Mechanics unlocked
- World-feel variation across biomes (surface materials + height ranges + features)
- Light that **flows**: skylight attenuation + torch block-light propagation
- Real inventory with stacking, backpack panel, and keyboard-reachable drag-and-drop
- New blocks (including a light source — the first "verb" block that affects world state beyond its own cell)

## Acceptance criteria (as tests)
- US-L4-01 — biome assignment deterministic (`tests/unit/biomes.test.ts`)
- US-L4-02 — biome transitions have no 1-block cliff (same)
- US-L4-03 — forest places trees (`tests/unit/trees.test.ts`)
- US-L4-04 — mountain mean height > plains mean height (`tests/unit/biomes.test.ts`)
- US-L4-05 — skylight reaches surface, blocked underground (`tests/unit/lighting.test.ts`)
- US-L4-06 — torch raises nearby block light (same)
- US-L4-07 — breaking torch triggers de-light propagation (same)
- US-L4-08 — shader renders illumination byte (`tests/e2e/torchlight.spec.ts`)
- US-L4-09 — `E` opens/closes backpack panel (`tests/e2e/inventory.spec.ts`)
- US-L4-10 — blocks stack to 64 (same)
- US-L4-11 — drag-and-drop preserves counts (same)
- US-L4-12 — inventory persists across reload (`tests/e2e/inventory-idb.spec.ts`)
- US-L4-13 — 5 new block types texture correctly (`tests/e2e/newBlocks.spec.ts`)
- US-L4-14 — no L1/L2/L3 regression (existing specs)

## Out-of-scope at L4 (defer to L5)
- Mobs, NPCs, pathfinding, AI
- Fluid simulation (water is cosmetic only if ADR-0016=a; else deferred)
- Crafting / recipe grid
- Audio
- Save slots, named-world picker
- Multiplayer / netcode
- Mobile touch controls

## Pitfalls
- Reaching for `Math.random` in biome assignment — RNG stays in `src/core/rng.ts` (hook blocks)
- Adding biomes **before** heightmap+cave in generator order → breaks L3 golden hash in unexpected places; keep biome layer AFTER
- Full BFS lighting on every chunk every frame → p95 blow-up; prefer dirty-queue (ADR-0014 pending)
- Hardcoding `maxStack=64` in UI instead of reading from `design/config.ts` — reviewer flags
- PointerLock swallows `E` keydown if we don't release on open — Playwright asserts both transitions
- Writing new block textures into their own file instead of extending `src/world/textures.ts` — fragments the atlas
- "While we're here, add crafting" — reviewer flags any `craft`/`recipe` term
- Water-as-full-cube cosmetic (if ADR-0016=a) looks like glass — opacity + fog tint required, approved via screenshot

## /goal condition shape
Every day names (a) commands to run, (b) exact exit condition per command, (c) requirement to show output in transcript. Example for Day L4-2:
```
/goal `npm test tests/unit/biomes.test.ts` passes (show vitest summary),
`npx tsc --noEmit` is clean, and `npm run e2e tests/e2e/streaming.spec.ts`
remains green under new terrain layer (show playwright report line).
```

---

## Week 1 — Foundations (Days L4-1 → L4-7)

Convention per day: **subagents · goal condition · acceptance · parallel/serial · Jon time**.

### Day L4-1 — Widget decisions locked + `design/config.ts` constants
- **Subagents:** `planner` (writes 5 ADRs: 0013 biome blending, 0014 lighting propagation, 0015 inventory serialization, 0016 water scope, 0017 torch rendering) · `game-designer` (adds `BIOMES`, `LIGHTING`, `INVENTORY` sections to `design/config.ts`)
- **Scope boundary:** planner → `docs/decisions/`, `docs/PRD-L4.md`, `docs/TSD-L4.md` (new). game-designer → `design/config.ts` only. No `src/` edits today.
- **Goal condition:** 5 ADRs committed in `docs/decisions/`; `design/config.ts` has the three new constant blocks; `npx tsc --noEmit` clean (no `src/` touched)
- **Acceptance:** `ls docs/decisions/ADR-{0013,0014,0015,0016,0017}-*.md` returns 5 paths; `grep -q 'BIOMES' design/config.ts && grep -q 'LIGHTING' design/config.ts && grep -q 'INVENTORY' design/config.ts` → exit 0
- **Test-first requirement:** none (docs + constants only)
- **Mode:** serial (planner first, then game-designer reads ADR values)
- **Jon time:** 20 min widget review + ADR skim

### Day L4-2 — Biomes (parallel double)
Two subagents on disjoint scopes.

| Subagent | File scope | Deliverable |
|---|---|---|
| `terrain-generator` | `src/gen/biomes.ts` (new), `src/gen/terrain.ts` (extend only — biome layer AFTER heightmap+caves), `tests/unit/biomes.test.ts`, `tests/unit/trees.test.ts` | `biomeAt(x,z): BiomeId` per ADR-0013; height-range + surface-material table; tree placement in forest; new golden hash locked for L4 |
| `voxel-engine-dev` | `src/world/blocks.ts` (add `log`, `leaves` only — rest come Day L4-6) | Block definitions for log + leaves with face UVs reserved in atlas; no texture rendering yet |

- **Scope boundary:** scope-guard hook enforces disjoint. `terrain-generator` may NOT touch `src/world/blocks.ts`.
- **Goal condition:** `npm test tests/unit/biomes.test.ts tests/unit/trees.test.ts` passes · `npm test tests/unit/terrain.test.ts tests/unit/terrain.golden.test.ts` passes with NEW golden hash committed · `npx tsc --noEmit` clean
- **Acceptance:** US-L4-01, US-L4-02, US-L4-03, US-L4-04 all green
- **Test-first requirement:** `biomes.test.ts` written BEFORE `biomes.ts`; must FAIL (`biomeAt` undefined) before implementation lands
- **Mode:** PARALLEL
- **Jon time:** 15 min review of each agent's report; approve new golden hash

### Day L4-3 — Block lighting storage + propagation
- **Subagents:** `voxel-engine-dev` (owns `src/world/lighting.ts` new, extends `src/world/chunk.ts` for illumination byte, `tests/unit/lighting.test.ts`)
- **Scope boundary:** no shader edits yet — storage + algorithm only. No `src/render/`.
- **Goal condition:** `npm test tests/unit/lighting.test.ts` passes · `npx tsc --noEmit` clean · lighting update p95 ≤ 2 ms on cave-rich chunk (perf harness in test)
- **Acceptance:** US-L4-05, US-L4-06, US-L4-07 green
- **Test-first requirement:** `lighting.test.ts` asserts skylight propagation + torch radius + de-light BEFORE implementation lands. Must FAIL (`skylight` function undefined) on first run.
- **Mode:** serial (single-agent, large single-file surface area)
- **Jon time:** 10 min review of perf numbers

### Day L4-4 — Lighting shader uniforms + render integration
- **Subagents:** `voxel-engine-dev` (operating in render scope — extends `src/render/chunkMaterial.ts` with `uBlockLight`, `uSkyLight` sampling from chunk vertex attribute or 3D texture per ADR-0017) · `qa-playtester` (writes `tests/e2e/torchlight.spec.ts`; regenerates L3 screenshot baselines where lighting change dirties them)
- **Scope boundary:** no `src/world/` edits (storage is already landed Day L4-3). Shader + mesher integration only.
- **Goal condition:** `npm run e2e tests/e2e/torchlight.spec.ts` passes (show playwright report) · `npm run e2e tests/e2e/dayNight.spec.ts` passes with new baselines · `npx tsc --noEmit` clean · frame-time with 10 torches p95 ≤ 16 ms
- **Acceptance:** US-L4-08 green; US-L3-10 still green under new shader
- **Test-first requirement:** `torchlight.spec.ts` asserts luminance delta between lit/unlit regions BEFORE shader uniform is wired. Must FAIL on first run (uniform zero → no delta).
- **Mode:** parallel (shader vs test authoring)
- **Jon time:** 15 min — eyeball lit-cave screenshot + approve dayNight baseline regeneration

### Day L4-5 — Inventory data model + UI (parallel double)
| Subagent | File scope | Deliverable |
|---|---|---|
| `voxel-engine-dev` | `src/player/inventory.ts` (new), `src/persist/inventoryStore.ts` (per ADR-0015), `tests/unit/inventory.test.ts` | Pure-data inventory with 36 slots (9 hotbar + 27 backpack); `addStack`, `moveStack`, `splitStack`; IDB persist round-trip |
| `ui-dev` | `src/ui/backpack.ts` (new DOM overlay), `src/ui/dnd.ts` (new HTML5 drag API), `tests/e2e/inventory.spec.ts`, `tests/e2e/inventory-idb.spec.ts` | `E` key toggle, panel markup, drag-and-drop (mouse + keyboard), pointer-lock release-on-open / re-acquire-on-close |

- **Scope boundary:** inventory-data file untouched by ui-dev; UI file untouched by voxel-engine-dev. Scope-guard enforces.
- **Goal condition:** `npm test tests/unit/inventory.test.ts` passes · `npm run e2e tests/e2e/inventory.spec.ts tests/e2e/inventory-idb.spec.ts` passes · `npx tsc --noEmit` clean · a11y Playwright check: `page.keyboard.press('Tab')` reaches backpack button; keyboard-only drag path works
- **Acceptance:** US-L4-09, US-L4-10, US-L4-11, US-L4-12 all green
- **Test-first requirement:** both test files written before their source files; initial run shows all four US failing with "not implemented" error
- **Mode:** PARALLEL
- **Jon time:** 20 min — feel-tune drag threshold + stack-split UX; 1-2 iterations expected

### Day L4-6 — New block types + textures
- **Subagents:** `voxel-engine-dev` (extends `src/world/blocks.ts` + `src/world/textures.ts` for `torch`, `sand`, `snow`, and `water` if ADR-0016=a) · `qa-playtester` (`tests/e2e/newBlocks.spec.ts` + atlas screenshot baseline)
- **Scope boundary:** no changes to lighting, inventory, or biome code today
- **Goal condition:** `npm run e2e tests/e2e/newBlocks.spec.ts` passes (show playwright report) · atlas screenshot approved · `npx tsc --noEmit` clean · bundle size delta ≤ +10 KB gz vs Day L4-5
- **Acceptance:** US-L4-13 green; US-L2-06 (atlas) still green under new atlas
- **Test-first requirement:** screenshot test registers before textures land; initial run fails on empty/pink texture
- **Mode:** serial
- **Jon time:** 15 min — approve atlas screenshot; eyeball water translucency (if applicable)

### Day L4-7 — Integration + Week-1 playtest + ship-gate rehearsal
- **Subagents:** `qa-playtester` (full suite: L1+L2+L3+L4 against feature flag `?l4=1`; 10-min scripted playtest covering biome crossing + torch cave + inventory session) · `reviewer` (banned-term grep, scope-guard sanity pass, bundle-size check, legal rule audit) · `perf-dev` (10-min walk capture; p95 budgets per PRD-L4 §4.2)
- **Scope boundary:** no feature code today; integration + verification only
- **Goal condition:** full suite green under `?l4=1` · `grep -rni -E 'minecraft|\\bmc\\b|creeper|\\bsteve\\b|enderman' src/ public/ docs/` returns zero · bundle ≤ 500 KB gz · 60 FPS p50 · memory ≤ 500 MB after 10 min · `npx tsc --noEmit` clean
- **Acceptance:** all 14 L4 user stories green plus every L1/L2/L3 story (US-L4-14 by composition)
- **Test-first requirement:** none (verification day); any failure spawns a dedicated fix-day in Week 2 before shipping
- **Mode:** serial (playtest → review → perf)
- **Jon time:** 25 min playtest + 10 min review of each agent's report

**Week 1 exit gate:** all 14 US green behind `?l4=1`. L3-default URL still unchanged. If any US fails, Week 2 starts with the fix sprint rather than ship work.

---

## Week 2 — Polish, playtest, ship (Days L4-8 → L4-12)

Modeled on L3 Week 3-4 (see `workplan-L3.md` §Week 3-4). Days below are **lower-fidelity drafts** — exact composition depends on Week-1 outcomes.

### Day L4-8 — P1 fix sprint (from Week-1 playtest)
- Subagents vary by what surfaced; `game-designer` tunes feel; `voxel-engine-dev` fixes bugs
- Goal: all Week-1 P1s fixed or explicitly deferred-with-reason to L5
- Jon time: 20 min triage

### Day L4-9 — External soft-playtest (3 testers × 20 min)
- `qa-playtester` coordinates playtest sheet in `docs/playtest/L4-week-2.md`
- Goal: 3 testers logged, P0/P1/P2 feedback categorized
- Jon time: 30 min outreach

### Day L4-10 — Flip `?l4=1` → default + remove flag
- `voxel-engine-dev` removes feature flag; `reviewer` audits
- Goal: `grep -r "?l4=" src/` empty; full suite green under L4-default
- Jon time: 10 min review of PR diff

### Day L4-11 — Prod deploy to CF Pages
- `voxel-engine-dev` bumps version, pushes to `main` for CF Pages auto-deploy; `qa-playtester` runs full Playwright suite against prod URL
- Goal: `curl -I https://chunksmith.<...>` returns 200; full e2e suite green against prod; COOP/COEP headers present
- Jon time: 10 min

### Day L4-12 — Ship-gate playtest + L4 retro + L5 PRD stub
- `qa-playtester` coordinates ≥10 external testers × 20 min
- `planner` writes `docs/retros/L4-SHIP.md` + `docs/PRD-L5.md` stub (mobs/netcode/audio tradeoff flagged for widget)
- Goal: 10 testers logged; no P0; retro + L5 stub committed; `v0.4.0` git tag
- Jon time: 45 min outreach + 15 min retro

**L4 ship gate (end of Week 2):** PRD-L4 §4.2 — all 14 user stories pass on prod URL; ≥10 testers × 20 min; no P0 in last 7 days; bundle ≤ 500 KB gz; 60 FPS p50; `tsc` clean; zero banned-term hits.

---

## Parallel/serial legend
- **Parallel day:** multiple subagents work in one invocation across disjoint file scopes. Scope-guard hook blocks any out-of-scope edit.
- **Serial day:** one subagent per step; next step depends on last.
- **Jon time:** at-keyboard minutes for Jon that day (review, playtest, deploy clicks).

## Risks to the schedule (if any slip)
- Day L4-1 widget may spawn follow-up questions on biome count or torch cap — budget +0.5 day
- Day L4-3 lighting p95 budget is the single biggest technical risk; if ADR-0014 choice fails perf gate, revert to greedy approximation (option c) rather than rebuild — budget +1 day for revert + re-test
- Day L4-5 inventory UX feel iterations usually overrun; budget 2 iterations with `game-designer`, 3rd pushes ship by +1 day rather than cut tests
- Week-2 external testers are human-dependent — begin outreach during Week 1

## Checkpoint summary
| Checkpoint | Day | Gate |
|---|---|---|
| Widget locked | L4-1 | 5 ADRs committed; constants in `design/config.ts` |
| Biomes landed | L4-2 | US-L4-01..04 green; new golden hash committed |
| Lighting algo landed | L4-3 | US-L4-05..07 green; perf p95 ≤ 2 ms |
| Lighting rendered | L4-4 | US-L4-08 green; dayNight baselines re-approved |
| Inventory landed | L4-5 | US-L4-09..12 green; a11y keyboard path green |
| New blocks landed | L4-6 | US-L4-13 green; atlas baseline approved |
| Week 1 end | L4-7 | All 14 US green behind `?l4=1` |
| L4 SHIP | L4-12 | Prod URL default-L4 + ≥10 testers × 20 min |

## Ship signal
3 biomes you can see from a hilltop, torch casts real light into a cave you dug, `E` opens a backpack you actually use, ≥10 testers × 20 min say "it feels different now," no P0 in 7 days.
