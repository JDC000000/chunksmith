# Chunksmith — Product Requirements Document (Level 4: The World Has Texture)
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Version:** 0.1 (draft skeleton — widget decisions pending)
**Status:** Draft; widget decisions LOCKED 2026-11-02 (see §2.1 — ADRs 0013-0017 accepted)
**Companion:** `PRD.md` (L1+L2), `PRD-L3.md` (L3), `TSD-L4.md` (to be drafted after widget), `docs/levels/level-4.md`

## 1. Vision
Different places look different. Caves feel like caves. Playing with blocks feels like doing something. L3 gave the world shape and time; L4 gives it texture, light, and the first real inventory.

**One-line pitch:** "A forest, a mountain, a plain — and a torch in your hand that actually lights the room."

## 2. Scope

### 2.1 Pending widget decisions (lock on Day L4-1)
| Area | Options | Candidate ADR |
|---|---|---|
| Biome blending | (a) Voronoi cells with hard borders · (b) noise-mixed weights across biomes · (c) explicit transition bands tagged by heightmap gradient | **ADR-0013 LOCKED → (b) noise-mixed weights** |
| Block-light propagation | (a) full BFS flood each frame · (b) incremental dirty-queue updates on edit · (c) greedy approximation (fixed radius, no occlusion) | **ADR-0014 LOCKED → (b) incremental dirty-queue** |
| Inventory serialization | (a) merge into existing IDB chunk-delta record · (b) separate `playerState` IDB record keyed by seed | **ADR-0015 LOCKED → (b) separate `playerState` record** |
| Water block scope | (a) cosmetic voxel in L4 (no flow, no physics) · (b) defer entirely to L5 | **ADR-0016 LOCKED → (a) cosmetic voxel at L4** |
| Torch rendering | (a) emissive shader channel driven by `uBlockLight` · (b) separate `THREE.PointLight` per torch (count-capped) | **ADR-0017 LOCKED → (a) emissive shader channel** |

Until these lock, every downstream day in `level-4.md` is a draft estimate.

### 2.2 In scope (L4 ship)
- **Biomes (3):** plains, forest, mountains. Each has its own surface materials, height-range multiplier, and feature set (trees in forest, taller peaks in mountains).
- **Smooth biome transitions:** no 1-block cliffs at biome borders. Transition strategy per ADR-0013.
- **Skylight attenuation:** sunlight propagates downward from `y = CHUNK_TOP`; occluded cells go dark.
- **Block light propagation:** torches emit light level 14; propagates per ADR-0014.
- **Illumination byte:** each voxel stores a packed `{skylight: 4 bits, blockLight: 4 bits}` byte alongside `blockId`.
- **27-slot backpack:** `E` opens the inventory panel; `Esc` or `E` closes it.
- **Block stacking:** max 64 per slot (constant in `design/config.ts`, not hardcoded).
- **Drag-and-drop:** between hotbar slots, backpack slots, and hotbar↔backpack. Count-aware; splits with right-click (half-stack).
- **5-6 new block types:** `log`, `leaves`, `torch`, `sand`, `snow`, and (pending ADR-0016) `water`.
- **New textures:** procedural at L4 (consistent with L2 pattern) in `src/world/textures.ts`; `public/textures/` kept as fallback source.
- **Inventory persistence:** survives tab close (strategy per ADR-0015).
- All L1 + L2 + L3 user stories still pass (no regression).

### 2.3 Out of scope (deferred to L5+)
- Mobs, NPCs, pathfinding, AI (L5 — large scope: AI + animation + physics interactions)
- Fluid simulation (never fully; cosmetic water max per ADR-0016)
- Crafting system / recipe grid (L5)
- Audio / sound effects / music (L5)
- Save slots / named-world picker / multi-world UI (L5, co-shipped with netcode)
- Multiplayer / netcode transport (L5 — `applyBlockChange` already server-shaped)
- Mobile touch controls (L5)
- Weather, clouds, moon phase, stars (L5+)
- Ore distribution, dungeons, structures (L5)

### 2.4 Hard non-goals (never)
- Mojang assets, textures, code, trademark
- No "Minecraft", "MC", "Creeper", "Steve", "Enderman" anywhere in filenames, strings, comments
- Minors as a target audience
- Social features that could become harassment vectors
- Any texture that is not CC0 or self-made (procedural)

### 2.5 Accessibility
- Inventory UI is **DOM overlay** (not canvas) — keyboard-reachable, screen-reader labelable, tab order defined
- All slot borders meet WCAG AA against both day and night backdrops (contrast ≥ 4.5:1)
- Drag-and-drop has keyboard equivalent: focus a slot, `Space` picks up, arrow keys move, `Space` drops
- No reliance on color alone to indicate stack state — stack count rendered as number
- Torch brightness tunable via `design/config.ts` for photosensitive viewers (clamp min at 0.4)

## 3. User Stories (acceptance = passing test)

| ID | Story | Acceptance test | Spec file |
|---|---|---|---|
| US-L4-01 | Biome assignment is deterministic from seed+(x,z) | Sample 1000 (x,z) coords from seed `E2E_SEED`; call `biomeAt(x,z)` twice → identical result; distribution across 3 biomes within ±5% of expected weights | `tests/unit/biomes.test.ts` |
| US-L4-02 | Biome transitions have no 1-block cliff | Across 1000 random biome-border pairs (sampled by scanning for adjacent cells with different biome IDs), `|h(x1,z1) - h(x2,z2)| ≤ 2 m` for 8-neighbor pairs | `tests/unit/biomes.test.ts` |
| US-L4-03 | Forest biome places trees on surface | In a 128×128 forest-dominant region at `E2E_SEED`, count ≥ 20 trees (contiguous log+leaves clusters) on surface | `tests/unit/trees.test.ts` |
| US-L4-04 | Mountain biome height exceeds plains | Mean surface height in mountain biome > mean in plains biome by ≥ 20 m across 10k samples at `E2E_SEED` | `tests/unit/biomes.test.ts` |
| US-L4-05 | Skylight reaches surface, is blocked underground | At any (x,z), `skylight(x, h(x,z)+1, z) === 15` and `skylight(x, h(x,z)-5, z) === 0` for 100 samples | `tests/unit/lighting.test.ts` |
| US-L4-06 | Torch placement raises nearby illumination | Place torch at (0, 32, 0); `blockLight(1, 32, 0) === 13`; `blockLight(14, 32, 0) === 0`; propagation respects opaque blocks | `tests/unit/lighting.test.ts` |
| US-L4-07 | Breaking a torch triggers correct de-light | Place torch, confirm lit neighbor, break torch, confirm neighbor `blockLight === 0` within 1 tick | `tests/unit/lighting.test.ts` |
| US-L4-08 | Shader renders illumination byte | Playwright screenshot of a torch-lit room at `t=0.0` (midnight) — mean luminance of lit 3×3 region > mean luminance of unlit region by ≥ 60/255 | `tests/e2e/torchlight.spec.ts` |
| US-L4-09 | `E` key opens/closes backpack panel | Press `E` → `document.querySelector('[data-panel="backpack"]').hidden === false`; press `E` again → `.hidden === true`; `Esc` also closes | `tests/e2e/inventory.spec.ts` |
| US-L4-10 | Blocks stack up to 64 per slot | Pick up 65 of block X → slot shows 64, excess (1) stays in world or next free slot per spec | `tests/e2e/inventory.spec.ts` |
| US-L4-11 | Drag-and-drop preserves counts | Start: hotbar[0]={id:1,count:30}, backpack[5]={id:1,count:40}. Drag hotbar[0]→backpack[5] → backpack[5]={id:1,count:64}, hotbar[0]={id:1,count:6} (overflow logic) | `tests/e2e/inventory.spec.ts` |
| US-L4-12 | Inventory persists across tab close | Place 3 blocks of type log in inventory → reload page → inventory still has 3 log | `tests/e2e/inventory-idb.spec.ts` |
| US-L4-13 | 5 new blocks texture correctly | Playwright screenshot baseline across one cell of each new block type (`log`, `leaves`, `torch`, `sand`, `snow`); (+ `water` if ADR-0016=a) | `tests/e2e/newBlocks.spec.ts` |
| US-L4-14 | No L1/L2/L3 regression | Full L1+L2+L3 suite passes under new biomes + lighting + inventory | existing specs |

## 4. Scope gates

### 4.1 P0 bug definition (extends L3 §4.1)
Crash · data loss (lost edits, lost inventory) · controls unresponsive · visual corruption blocking play · security issue · fall-through-world · stuck-in-geometry · torch leaks infinite light (perf death) · inventory UI traps keyboard focus · banned-term string present in bundle.

### 4.2 L4 ship gate
- All US-L4-01 through US-L4-14 pass on prod URL
- ≥10 external testers × 20 min each (bar rising from L3's 5 testers)
- No P0 bugs in last 7 days
- Bundle ≤ **500 KB** gzipped (headroom from 400 KB at L3 → +100 KB for lighting + inventory + biomes)
- 60 FPS p50 on 2020 MacBook over 10 min walk including biome boundary crossings and 10+ torch placements
- Memory steady-state ≤ **500 MB** after 10 min (up from 400 MB — illumination byte doubles per-cell cost)
- Playwright + Vitest suite green; `npx tsc --noEmit` clean
- `./scripts/legal-check.sh` exits 0 (scans `src/ public/ design/ scripts/ tests/` for Mojang-IP terms; see CLAUDE.md Legal rules)

### 4.3 L5 entry gate
- ≥20 external testers × 30 min
- No P0 bugs in last 14 days
- L5 PRD + TSD drafted
- L4 retro committed
- Netcode spike completed (confirm `applyBlockChange` works over WebRTC data channel in a toy harness)

## 5. Risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | Lighting propagation choice (ADR-0014) is wrong at scale — BFS flood takes >16 ms on cave-rich chunk | H | H | Day L4-1 widget forces explicit perf budget per option; incremental (b) is default favorite; perf gate on Day L4-3 |
| 2 | Illumination byte doubles chunk memory → GC pressure | M | M | Pack `{sky:4,block:4}` into existing padding of ChunkData; measure before/after on Day L4-3 |
| 3 | Biome transitions produce visible cliff despite ADR-0013 strategy | M | H | US-L4-02 asserts max 2 m delta on 8-neighbors; failing test → re-tune blend weights, not re-pick strategy |
| 4 | Inventory UI focus-traps keyboard (a11y P0) | M | H | DOM overlay with real `<button>` elements; Playwright a11y assertion in Day L4-5 |
| 5 | Water (if ADR-0016=a) looks weird as a solid cosmetic cube | H | M | Translucent material with `opacity ≤ 0.6`; defer to L5 if screenshot review on Day L4-6 fails |
| 6 | Torch count explodes → draw-call storm (if ADR-0017=b PointLight) | M | H | Cap active PointLights at 32 (nearest-to-player); batch others into emissive shader fallback |
| 7 | New block textures look inconsistent with L2 procedural atlas style | M | M | `voxel-engine-dev` extends existing `textures.ts` generator functions, not a new file; reviewer approves atlas screenshot |
| 8 | Inventory serialization bug corrupts IDB → player loses inventory on reload | L | H | Schema versioning (bump `IDB_VERSION`); on mismatch, log + reset inventory only (not world edits) |
| 9 | Biome generator breaks L3 golden hash → regression on US-L3-01, US-L3-08 | H | H | Add biome layer AFTER heightmap+caves in generator order; L3 hash recomputed intentionally; version-tag new hash |
| 10 | "While we're here, add crafting" scope creep | H | M | Explicitly out of scope in §2.3; reviewer flags any `craft`/`recipe` term |
| 11 | Jon's at-keyboard time overruns on inventory UX feel | M | M | Day L4-5 budgets 2 iterations with `game-designer`; if 3rd needed, shift ship-gate +1 day rather than cut tests |
| 12 | PointerLock interferes with inventory drag-and-drop | H | H | `E` releases pointer lock on open; `Esc` or close returns pointer to game; Playwright asserts both transitions |

## 6. Constraints
- **Time:** Jon's calendar ~2-3 weeks; ~60-120 focus hours of subagent-time. At-keyboard target: < 90 min/day.
- **Budget:** no new paid services; procedural textures (zero asset cost); any new npm dep must justify <5 KB gz.
- **Legal:** CC0 or self-made assets only; no Mojang IP.
- **Platforms:** desktop Chrome/Edge/Firefox; mobile deferred to L5.
- **Must not regress:** L1 (`smoke`, `controls`, `perf`), L2 (`streaming`, `interact`, `hotbar`, `persistence`, atlas), L3 (`walk`, `physics`, `flight`, `persistence-idb`, `dayNight`, `regen`, `spawn`, `wipe`) suites all green under L4 changes.

## 7. Dependencies
- **Likely new npm:** none required if we keep procedural textures and in-tree lighting. **Candidate reach:** `@react-dnd/*` or `interactjs` for drag-and-drop — **avoid** unless hand-rolled HTML5 drag API proves worse in Day L4-5 spike (both exceed 10 KB gz).
- Existing deps unchanged: `three`, `simplex-noise`, `idb-keyval`.
- `simplex-noise` reused for biome weights — no new noise lib.

## 8. Open questions (surface, don't guess)
- **Biome count:** 3 is the L4 target. If widget favors Voronoi cells, 4-5 is nearly free. Flag for Day L4-1.
- **Tree density tuning:** forest trees per chunk — default 3-5, pending `game-designer` tuning on Day L4-2.
- **Torch light level:** default 14 (matching genre convention). Falls off by 1 per block. Confirm on Day L4-1.
- **Snow biome vs snow block as mountain-cap:** L4 ships only mountain-cap snow (no snow biome). Full snow biome deferred to L5.
- **Water (if ADR-0016=a):** does the player drown? **No** at L4 — water is cosmetic only, physics treats as air.
- **Inventory full behavior:** when backpack+hotbar are full and player picks up a block — drop on ground? refuse to break? Default: block cannot be broken (clicks fail silently) → confirm on Day L4-5.
- **Hotbar count:** stays at 9 (L2) or expands to match backpack row? Default: stays at 9.

## 9. Launch plan
- **Soft (end of Week 1 of L4):** Jon + 3 contacts × 20 min, feature-flagged under `?l4=1`
- **Public (L4 ship):** Jon's X with 90-sec screencap showing biome transition at sunrise + torch-lit cave + inventory open; build-in-public thread continues
- **Metrics:** CF analytics free tier, session timer in-app, Sentry free tier; add inventory-event telemetry (slot-open rate, drag-count) to inform L5 crafting scope
