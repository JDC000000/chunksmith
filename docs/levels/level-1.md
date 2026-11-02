# Level 1 — Hello Voxel (Day 1-3)

**Ship target:** end of Day 3.

## Scope
Flat ground + first-person camera walking around with WASD. No chunks yet, no block interaction. Prove the Three.js scene/camera/renderer loop works, the Vite dev loop works, Playwright smoke runs, and the agent-orchestrated repo has a working `/goal` → verify → ship cycle.

## Acceptance criteria (as tests)
- US-L1-01: `tests/e2e/smoke.spec.ts` passes — no console errors, canvas present, `window.__game` installed
- US-L1-02: `tests/e2e/smoke.spec.ts` — overlay has `hidden` class after clicking "click to play"
- US-L1-03: `tests/e2e/controls.spec.ts` (Day 3) — WASD moves `window.__game.camera.position`
- US-L1-04: perf capture — median FPS ≥ 55 over 10 s continuous walk

## Non-goals at L1
- No chunks (deferred L2)
- No block interaction (deferred L2)
- No gravity, no collision (deferred L3)
- No procedural terrain (deferred L3)
- No multiplayer (deferred L5)

## Pitfalls
- Over-engineering a "game loop" class on Day 1 — a single `tick(now)` function is enough
- Fighting PointerLock on Safari before Chrome works — Chromium first
- Trying to add textures ("while I'm here") — that's L2, resist
