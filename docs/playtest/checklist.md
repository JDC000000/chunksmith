# Playtest Checklist (L1-L2)
15 min, run at end of Day 3 / Day 5 / Day 7. Copy to `docs/playtest/YYYY-MM-DD.md` with results.

## L1 (end of Day 3)
- [ ] Loads <2s on your actual connection
- [ ] 3D scene visible immediately, no white flash
- [ ] No console errors in DevTools first 5s
- [ ] Click → pointer locks, overlay hides
- [ ] WASD moves camera smoothly
- [ ] Mouse look rotates camera smoothly
- [ ] Esc releases pointer, overlay returns
- [ ] 60 FPS steady (F3 to view stats)
- [ ] Alt-tab out & back recovers cleanly
- [ ] Feels like a game, not a tech demo

### Automated checks (as of 2026-11-02, Day 3)
Run with `npm run e2e`. Passing here does NOT replace the manual items above; it only means they are less likely to be broken.

| Story | Spec | What it proves | What it does NOT prove (still manual) |
|---|---|---|---|
| US-L1-01 | `tests/e2e/smoke.spec.ts` (existing) | Page boots, canvas present, no console errors, `window.__game` exposes scene/camera/renderer/world | Load time <2s on a real connection; no white flash |
| US-L1-02 | `tests/e2e/smoke.spec.ts` (existing) | Overlay is present, click does not error | Pointer actually locks and overlay hides (headless lock is unreliable; the spec only asserts the DOM state is valid). Esc returns overlay |
| US-L1-03 | `tests/e2e/controls.spec.ts` (new, Day 3) | `moveForward(5)` = -5 z, `moveRight(5)` = +5 x, KeyW with controls unlocked does not move the camera (render loop confirmed running) | Real W/A/S/D keys through the locked tick loop; "smoothly"; mouse look |
| US-L1-04 | `tests/e2e/perf.spec.ts` (new, Day 3) | Median FPS over a 5 s sample while the camera moves, after a 2 s warm-up, meets `FPS_FLOOR` (currently 40, headless software GL) | The PRD's 60 FPS target on a real GPU over a 10 s walk; Alt-tab recovery |

Not automatable, still required: **Jon's 15-min live playtest** (all items above, plus Feel questions and Crash probes).

Notes for whoever runs e2e:
- Run it alone. A second `playwright test` against this repo wipes `test-results/` mid-run (shows up as `ENOENT ... .playwright-artifacts-0`) and, on this 2-core box, starves the renderer so FPS drops.
- Editing `src/` while e2e runs makes Vite reload the page. `perf.spec.ts` and the unlocked-KeyW test detect this and fail with "page reloaded" rather than reporting a bogus result.
- `perf.spec.ts` turns Playwright tracing off for itself; trace screenshots of the software-GL canvas visibly cut FPS (one traced run: median 41; untraced runs: 53-60).

## L2 (end of Day 7)
- [ ] All L1 still passes (no regression)
- [ ] Walk 100 blocks → new chunks appear ahead
- [ ] Chunks behind unload (verify memory in DevTools)
- [ ] No visible seams between loaded chunks
- [ ] FPS stays ≥55 during continuous walking
- [ ] Left-click a block → disappears
- [ ] Break feels instant (<50 ms)
- [ ] Right-click adjacent space → block appears
- [ ] New block = current hotbar selection
- [ ] Place AT chunk boundary → no floating hole
- [ ] Break AT chunk boundary → no seam
- [ ] Keys 1/2/3 switch block type
- [ ] Hotbar shows current selection
- [ ] Place 10 blocks → walk 50 blocks away → walk back → pattern intact

## Feel questions (free text)
- When you look at the world for the first time, do you want to do something? What?
- Is the first thing you tried something the game supported?
- Did anything surprise you — good or bad?
- Would you play again tomorrow for 10 min?

## Crash probes
- [ ] Spam left-click 20× on different blocks → no crash
- [ ] Hold W+S simultaneously → no crash
- [ ] Hold mouse button and whip the camera
- [ ] Place blocks in a long line very quickly
- [ ] Resize window during gameplay
- [ ] Change tab for 2 min, come back

## P0 definition
Crash · data loss · controls broken · visual corruption blocking play · security issue. Anything else is P1/P2.
