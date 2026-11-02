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
