# Chunksmith

Browser voxel sandbox. Vite + TypeScript + Three.js, built autonomously by Claude Code subagents following the 5-level teaching ladder.

**Status:** Day 1 scaffold — Level 1 "Hello Voxel"

## Quickstart

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit
npm run e2e          # Playwright E2E (spawns dev server)
npm run typecheck    # tsc --noEmit
npm run build        # production bundle
```

## Project map
- `src/main.ts` — scene bootstrap, camera, controls, render loop
- `src/core/rng.ts` — seeded PRNG (cyrb128 + splitmix32)
- `src/world/blocks.ts` — block registry (grass, dirt, stone)
- `src/debug/seeds.ts` — DEV/E2E/DEMO seed constants
- `src/debug/gameAPI.ts` — `window.__game` for Playwright
- `design/config.ts` — all game-feel numbers (owned by `game-designer`)
- `docs/PRD.md` · `docs/TSD.md` · `docs/levels/*.md` · `docs/decisions/*.md` — product/technical spec
- `.claude/agents/*.md` — 8 subagent definitions
- `.claude/hooks/*.sh` — scope-guard + typecheck + guard-bash
- `tests/unit/` · `tests/e2e/` — Vitest + Playwright

## Levels (planned)
| L | Scope | ~Time |
|---|---|---|
| 1 | Walk around in first-person | 1 weekend (Day 1-3) |
| 2 | Place/break blocks, chunk streaming, 3 block types | 1 week (Day 4-7) |
| 3 | Procedural terrain, caves, day/night, physics, save/load | ~1 month |
| 4 | Biomes, trees, water/lava shaders, mob, ECS refactor | ~3 months |
| 5 | Multiplayer, modding, PWA, Steam/Itch release | ~6-12 months |

See `docs/levels/level-N.md` and the full planning package at `~/Documents/Claude/Projects/Voxel Sandbox Oct 26/`.

## Legal
Original work. No Mojang IP. CC0 or self-generated assets only.

## License
TBD — tentatively MIT.
