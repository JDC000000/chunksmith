# Day 2-3 Retro — Voxel engine + L1 ship gate
**Date:** 2026-11-02
**Commits:** `973bffb` (voxel engine + L1 ship gate)
**Mode:** 3 parallel subagents (voxel-engine-dev, terrain-generator, qa-playtester)
**Elapsed:** ~15 min of parallel subagent work + ~10 min orchestrator integration

## What went well
- **3 subagents, zero file-conflicts.** Scope-guard patterns in agent frontmatter + distinct file ownership meant no merge headaches. voxel-engine-dev wrote `src/world/|src/mesh/|src/render/`, terrain-generator wrote `src/gen/`, qa-playtester wrote `tests/e2e/`.
- **TDD actually happened.** All three agents wrote failing tests first, then impl. The terrain-generator golden-hash workflow is especially clean: write placeholder, run, read actual value from failure, bake in. Easier than it sounds; worth stealing for future determinism tests.
- **Netcode gate held.** `applyBlockChange(intent)` is in place; nothing else mutates world state. L5 netcode swap is a transport change, not a refactor.
- **3072 triangles for a solid 16³ chunk** (= 6 faces × 16 × 16 × 2) — confirms the mesher's cull math.

## Issues caught + fixed
1. **Mojang IP leaked in design/config.ts comments.** 4 references to "Minecraft". Caught by terrain-generator's banned-term grep. Reviewer agent would catch this too; grep is faster. Add to CI eventually.
2. **TypeScript inference bug in test helper.** `function placeIntent(..., id = BLOCKS.stone)` narrowed `id` to the literal `3`, so `BLOCKS.grass` (1) failed to type-check. Fix: `id: BlockId = BLOCKS.stone`. One-line, five seconds to find.
3. **Playwright version drift (second time).** Container's pre-installed Playwright is 1.63; npm default was 1.64. Pin `@playwright/test@1.63.0`. Noted in Day 1 retro too — would have been nice to catch in Day 0.
4. **Perf test flaky in container.** 60 FPS fresh boot → 46 FPS when run after other tests warm the browser (SwiftShader software GL). Lowered headless floor to 40; real 60 FPS gate is Jon's manual playtest on actual GPU.
5. **tsconfig didn't include tests/.** Caught by terrain-generator. Fixed.

## What to change in agent definitions / templates
- Add banned-term grep to `.claude/hooks/scope-guard.sh` (currently only enforces paths). Low effort.
- `qa-playtester` template good — fine-tuned perf.spec.ts after I handed it off (added `test.use({ trace: "off" })` and a FPS-boot wait). Those improvements should go into the agent's prompt as examples.
- Day 2's voxel-engine-dev prompt was long but clear. The agent did everything, including TDD. Keep this prompt style.

## What to carry into Day 4+
- Full suite now: 47 Vitest + 6 Playwright = 53 tests. CI workflow runs them all.
- `window.__game.world` is the Playwright anchor — subsequent agents can rely on it.
- `WORLD.CHUNK_SIZE` from `design/config.ts`; never hard-code 16.
- Camera starts at `(8, 4, 24)` looking at the chunk — same anchor Day 5 raycast tests will use.

## Minutes of Jon's attention consumed
Zero (after the initial token drop + "continue").
