# Day 1 Retro — Chunksmith L1 scaffold
**Date:** 2026-11-02
**Build:** `ff0c32e` (initial commit)
**Mode:** autonomous (orchestrator + no subagents invoked — direct writes)
**Elapsed:** ~45 min from "go" to shipped commit

## What went well
- Three.js r0.187 scaffold with Vite + TS + vitest + Playwright went in without surprises
- Fixed-seed convention (`DEV_SEED`/`E2E_SEED`/`DEMO_SEED`) locked in from Day 1 — Day 2+ determinism tests inherit this
- Netcode gate (`applyBlockChange` signature) documented in TSD §2.7 before any mutation code exists → cheap to enforce later
- `window.__game` debug surface exposed early → Playwright has deterministic hooks instead of pixel-watching
- 132 KB gz bundle on Day 1 → well under 300 KB L2 budget, no bundle anxiety yet
- scope-guard.sh smoke-tested with 4 permutations before first commit → confidence that subagent scoping actually blocks

## What was unexpected
- Playwright version drift (1.64 default vs 1.63 pre-installed in container) — one install step wasted
- `PointerLockControls.getObject()` was renamed to `.object` in Three.js r0.183+ — needed a one-line fix post-typecheck
- Cloudflare API blocked by the agent proxy — pivoted to GitHub-integration deploy (actually cleaner for hands-off goal)

## What to change in agent definitions
- Add to `voxel-engine-dev` prompt: "If a Three.js API call breaks typecheck, check the API docs for r0.187 — don't assume older signatures." (The agent will have the error output; still, a one-liner heads-up saves a cycle.)
- `terrain-generator` prompt should explicitly say the determinism golden-hash lock-in pattern. Done in Day 2 prompt.

## What to carry into Day 2
- Keep CHUNK_SIZE referenced from `design/config.ts`, not hard-coded
- First-use test for `window.__game.world` after it's installed will land in Day 3 controls+perf tests
- Mesher is Worker-ready: no `three` imports in `src/mesh/`

## Minutes of Jon's attention consumed
Zero. All autonomous after the "go" signal + token drop.
