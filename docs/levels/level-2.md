# Level 2 — Build & Break (Day 4-7)

**Ship target:** end of Day 7 (prod URL on Cloudflare Pages).

## Scope
"Infinite" flat world of chunks that stream around the player. Procedural texture atlas with 3 block types (grass, dirt, stone). Left-click breaks, right-click places. Hotbar with number keys 1/2/3. Edits persist in-memory as player walks away.

## Acceptance criteria (as tests)
- US-L2-01 — chunks stream around player (`streaming.spec.ts`)
- US-L2-02 — left-click breaks block <50 ms (`interact.spec.ts`)
- US-L2-03 — right-click places block on target face (`interact.spec.ts`)
- US-L2-04 — number keys switch hotbar (`hotbar.spec.ts`)
- US-L2-05 — walk away + return preserves edits (`persistence.spec.ts`)
- US-L2-06 — 3 block types texture correctly, screenshot baseline

## Build plan (per Workplan Day 4-7)
- Day 4: ChunkManager + superflat world (y=0 grass, y>0 air) at 8-chunk radius; naive mesher emits top faces only
- Day 5: full naive-culled meshing with neighbor-chunk awareness; 3D DDA raycast; place/break; applyBlockChange netcode gate
- Day 6: procedural texture atlas (canvas, 3 blocks), hotbar DOM overlay, in-memory edit persistence
- Day 7: Cloudflare Pages prod deploy; final playtest; retro

## Non-goals at L2
- Hills, caves, procedural terrain (L3)
- Gravity, jumping, collision (L3)
- IndexedDB persistence (L3)
- Audio (L4)
- Multiplayer (L5)

## Pitfalls
- Per-cube Mesh instead of per-chunk merged geometry → GPU death at chunk 20
- Forgetting neighbor re-mesh on chunk-boundary edits → floating holes
- UV bleeding at atlas edges — fix with 1-px padding + NearestFilter
- "Let me add hills now" — save for L3
- Day 5 is heaviest single day; if raycast slips, invoke the Day 5a/5b split in Workplan §8

## Ship signal
8-chunk radius at 60 FPS, break/place feels instant, Jon's 15-min playtest green, ≥3 external testers × 10 min each, no P0 in 7 days.
