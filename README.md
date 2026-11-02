# Chunksmith

Browser voxel sandbox. Vite + TypeScript + Three.js, built autonomously by Claude Code subagents following a 5-level teaching ladder.

**Status:** L2 feature-complete — walk, place, break blocks across a streaming world. Texture atlas (Day 6b) in progress. CF Pages deploy pending.

[![CI](https://github.com/JDC000000/chunksmith/actions/workflows/ci.yml/badge.svg)](https://github.com/JDC000000/chunksmith/actions/workflows/ci.yml)

## Play it

**Online:** coming soon at [`chunksmith.pages.dev`](https://chunksmith.pages.dev) (pending Day 7 deploy).

**Locally:** see `docs/PLAY_LOCALLY.md`. TL;DR:
```bash
git clone https://github.com/JDC000000/chunksmith.git
cd chunksmith
npm install
npm run dev
# open http://localhost:5173
```

**Controls:** click to lock pointer → **WASD** walk, **mouse** look, **left-click** break, **right-click** place, **1/2/3** or mouse-wheel to switch block, **Esc** to pause.

## Quick commands
```bash
npm run dev          # dev server at http://localhost:5173
npm test             # Vitest unit (71 tests)
npm run e2e          # Playwright E2E (26 tests, spawns dev server)
npm run typecheck    # tsc --noEmit
npm run build        # production bundle (~136 KB gz)
```

## Project map
```
src/
├── main.ts                 # scene bootstrap, controls, click handler, debug API
├── core/rng.ts             # cyrb128 + splitmix32 seeded PRNG
├── world/                  # three-free: types.ts, blocks.ts, Chunk.ts, World.ts, ChunkManager.ts
├── gen/terrain.ts          # three-free: deterministic terrainAt(seed, cx, cy, cz)
├── mesh/naiveMesher.ts     # three-free: pure mesh builder
├── player/                 # raycast.ts (3D DDA), applyBlockFromHit.ts
├── render/                 # three-dependent: textures, chunkMaterial, chunkRenderer
├── ui/                     # DOM-overlay hotbar
└── debug/                  # window.__game surface + fixed seeds (DEV/E2E/DEMO)

design/config.ts            # all tunable game-feel numbers (owned by game-designer agent)
docs/                       # PRD, TSD, ADRs, level docs, retros, DEPLOY, PLAY_LOCALLY
.claude/                    # 8 subagent definitions + scope-enforcing hooks + MCP config
tests/unit/                 # Vitest: rng, blocks, chunk, world, chunkManager, mesher, terrain, raycast, player
tests/e2e/                  # Playwright: smoke, controls, perf, hotbar, interact
```

## Levels (planned)
| L | Scope | Status | ~Time |
|---|---|---|---|
| 1 | First-person walk in a Three.js scene | ✅ shipped | 1 weekend |
| 2 | Place/break blocks, chunk streaming, hotbar | ✅ feature-complete | 1 week |
| 3 | Procedural terrain, caves, day/night, physics, IDB persistence | planned | ~1 month |
| 4 | Biomes, trees, water/lava shaders, mob, ECS refactor | planned | ~3 months |
| 5 | Multiplayer, modding, PWA, Steam/Itch release | planned | ~6-12 months |

See `docs/levels/level-N.md` and `docs/TSD.md` for the full architecture.

## How it was built

6 named Claude Code subagents (`planner`, `game-designer`, `voxel-engine-dev`, `terrain-generator`, `physics-dev`, `ui-dev`, `qa-playtester`, `reviewer`) each owning a disjoint file scope, enforced by `.claude/hooks/scope-guard.sh`. The orchestrator session fires 2-3 in parallel per day via git-less file isolation. Retros in `docs/retros/`.

## Legal
Original work. No Mojang IP. CC0 or procedurally-generated assets only. See `docs/decisions/` for ADRs.

## License
MIT (planned).
