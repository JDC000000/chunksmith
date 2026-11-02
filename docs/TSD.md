# Chunksmith — Technical Scoping Document
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Version:** 1.0
**Companion:** `PRD.md`, `../CLAUDE.md`

## 1. Stack (locked)
Vanilla Three.js r0.187+ with WebGLRenderer (WebGPURenderer behind feature flag at L3+), TypeScript on Vite 8, chunked voxel world (16×16×16 Uint8Array + palette), binary greedy meshing in Web Workers via Transferable ArrayBuffers (naive culling at L2), simplex-noise v4 at L3, custom swept-AABB physics + 3D DDA raycasting (not Cannon/Rapier), idb-keyval persistence at L3, texture-array materials (not atlas), Howler.js audio at L4, deployed to Cloudflare Pages, Colyseus for multiplayer at L5.

Rejected: Babylon.js (smaller community), raw WebGL (yak-shaving), React Three Fiber (reconciliation overhead in hot loop), cannon-es / Rapier (overkill for voxel grid).

## 2. Key decisions

### 2.1 Rendering: Three.js
2.7M weekly downloads, deepest Claude Code training corpus. WebGLRenderer at L1-L2 for universal support; WebGPURenderer at L3+ once perf matters.

### 2.2 Chunk size: 16×16×16 flat Uint8Array
See `ADR-0002-chunk-size.md`. Index: `x + z*16 + y*256`. 4 KB per chunk → fits L1 cache, Transferable zero-copy to workers.

### 2.3 Meshing
- L2: naive culled (ship first, prove correct)
- L3: binary greedy meshing in Web Worker pool (`navigator.hardwareConcurrency - 1`)

### 2.4 Terrain (L3)
`simplex-noise` v4 (jwagner), seeded via `cyrb128 + splitmix32` from a string seed.

### 2.5 Physics (L3+)
Custom swept-AABB vs voxel grid, axis order X/Z/Y (Y last for step-up).
Raycast: 3D DDA (Amanatides & Woo 1987), max reach from `design/config.ts`.

### 2.6 Persistence (L3)
IndexedDB via `idb-keyval`. Keys: `chunk:${worldId}:${cx},${cy},${cz}`. 5s debounced flush in `requestIdleCallback`.

### 2.7 Netcode gate — `World.applyBlockChange` signature (adopt at L2, keep stable through L5)

```typescript
// src/world/types.ts (write in Day 2)
export type PlayerId = string & { __brand: "PlayerId" };
export type BlockCoord = { x: number; y: number; z: number };
export type BlockId = number; // see src/world/blocks.ts

export type BlockChangeIntent = {
  playerId: PlayerId;
  pos: BlockCoord;
  blockId: BlockId;
  reason: "place" | "break";
  timestamp: number;
};

export type BlockChangeResult =
  | { ok: true; chunkKey: string; dirtyChunks: string[] }
  | { ok: false; reason: "out-of-reach" | "out-of-bounds" | "occupied" | "unauthorized" };
```

At L5, the client sends `intent` to the server; server runs `applyBlockChange`; broadcasts result. No new type required — just a transport swap.

### 2.8 Textures: texture array (not atlas)
WebGL2 + WebGPU both support `sampler2DArray`. Each face samples `texArray[blockId * 6 + faceIndex]`. L2 generates the array procedurally on an HTML canvas at startup.

### 2.9 Deploy: Cloudflare Pages
`public/_headers`:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```
Needed for SharedArrayBuffer in L3 worker transfer.

### 2.10 Fixed seeds (`src/debug/seeds.ts`)
- `DEV_SEED` — all dev chunks
- `E2E_SEED` — all Playwright tests
- `DEMO_SEED` — the shipped demo world

## 3. Performance budgets

| Metric | Target |
|---|---|
| Steady-state FPS | 60 (16.6 ms/frame) |
| Main-thread per frame | ≤ 8 ms |
| Visible triangles | ≤ 2M |
| Draw calls per frame | ≤ 300 |
| Load radius | 8H × 4V chunks |
| Chunk load latency (gen worker) | ≤ 100 ms |
| Block edit → remesh visible | ≤ 50 ms |
| Memory steady-state | ≤ 400 MB |
| Initial JS bundle (gzip) | ≤ 300 KB |
| LCP on 4G throttled | ≤ 2 s |

CI gates: budget × 1.25 → warning, × 1.5 → fail.

## 4. Risk register

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| 1 | Scope creep into multiplayer / mobs before L1-L2 ships | H | H | Hard gate: no multiplayer, no octrees, no shaders beyond texture-array until L2 ships + ≥3 testers × 10 min |
| 2 | AI can't judge visual feel + assets + balance | H | H | `qa-playtester` + Jon playtests Day 3/5/7 + Playwright screenshot baselines |
| 3 | Vague prompts cause subagent misreading | M | M | `/goal` conditions with testable AC + TDD mandated in CLAUDE.md |
| 4 | GC pauses from Float32Array in mesher hot loop | M | H | Pre-allocated scratch buffers; free-list pool |
| 5 | IDB write storm (L3+) blocks UI | M | M | 5s debounce in requestIdleCallback |
| 6 | Worker postMessage overhead | M | M | SharedArrayBuffer once COOP/COEP configured |
| 7 | Playwright screenshot flakes across machines | M | L | Pinned Docker image for CI; local run review-only |
| 8 | Legal drift (subagent adds Creeper) | L | H | `reviewer` flags any Mojang IP in filenames/strings |

## 5. First skeleton (~700 LOC when complete)
See `../src/` tree. Day-1 files written: `src/main.ts`, `src/core/rng.ts`, `src/world/blocks.ts`, `src/debug/{seeds,gameAPI}.ts`, `design/config.ts`. Day 2 adds Chunk + World + mesher + terrain worker.

## 6. Test strategy
- Unit (Vitest): index math, face counts, terrain determinism, collision math, DDA raycast
- E2E (Playwright): all PRD user stories; screenshot regression with fixed seed/camera; pinned env
- Perf: `stats.js` + Vitest headless, p50 < 16.67 ms over 10 s walk
- Playtest: `docs/playtest/checklist.md`, dated reports in `docs/playtest/`

## 7. Decisions log
- ADR-0001 Rendering engine (Three.js) — see TSD §1 and §2.1
- ADR-0002 Chunk size — see `decisions/ADR-0002-chunk-size.md`
- ADR-0003 Language (TypeScript) — locked
- ADR-0004 No R3F — locked
- ADR-0005 Physics (custom AABB) — locked
- ADR-0006 Textures (array not atlas) — locked
- ADR-0007 Hosting (Cloudflare Pages) — locked
- ADR-0008 Multiplayer deferred to L5 — locked
