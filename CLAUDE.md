# Chunksmith (Voxel Sandbox)
Browser voxel sandbox. Vite + TypeScript + three.js. L1 → L4 all have per-level docs at `docs/levels/level-N.md`. L1-L3 are shipped; L4 is drafted and awaiting Day L4-1 widget-lock. L5 is netcode and not yet drafted.

## Commands
- `npm run dev`          dev server at http://localhost:5173
- `npm test`             Vitest; while iterating, run only the file you changed
- `npm run e2e`          Playwright; starts dev server automatically; fixed seed
- `npm run typecheck`    tsc --noEmit — run before reporting any task done

## Architecture rules
- Game state lives in `src/core` and `src/world`. Render + UI READ state; they NEVER mutate it.
- All randomness goes through seeded RNG in `src/core/rng.ts`. `Math.random` is banned in `src/world`.
- Block definitions live only in `src/world/blocks.ts`.
- Physics + UI constants come from `design/config.ts` (owned by `game-designer`).
- Mutation entry point: `World.applyBlockChange(intent)` with the type signature in `docs/TSD.md` §2.7. Nothing else mutates. This is the netcode gate.
- Subagents live in `.claude/agents/`. Stay inside your file scope — hooks enforce this.

## Verification (non-negotiable)
- Any change to `src/world` or `src/player` needs a unit test that FAILS before the change.
- Report done only with test output, tsc result + e2e result. "Should work" is not done.
- Visual changes need a Playwright screenshot compared to baseline.

## Legal rules (hard)
- No Mojang IP: no "Minecraft", "MC", "Creeper", "Steve", "Enderman" in filenames, strings, or comments.
- Enforcement: `./scripts/legal-check.sh` scans `src/ public/ design/ scripts/ tests/` and exits non-zero on any hit. Called from CI and from every PRD's ship-gate. `docs/` is intentionally excluded — PRDs may quote the rule itself.
- Textures must come from `public/textures/` and be CC0 or self-made (procedural at L2). Reviewer flags violations.

## Example /goal condition shape
```
/goal npm run dev starts, a three.js scene renders with no console errors (show
the Playwright result), npm test passes, and npx tsc --noEmit is clean
```
Every `/goal` names: (a) commands to run, (b) exact exit condition per command, (c) requirement to show output in transcript.

## Gotchas
- Headless WebGL output varies by machine. Run e2e screenshot regression in the pinned Docker image only.
- Do not run broad automated refactors. Keep diffs reviewable.
- PointerLock behavior differs on Safari — test Chrome first.
