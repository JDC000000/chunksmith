# Chunksmith — Product Requirements Document (Levels 1-2 MVP)
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Version:** 1.0
**Status:** Pre-approved for L1 scaffold

## 1. Vision
Browser-playable voxel sandbox. Zero install. Shareable URL. Walk, place, break blocks at 60 FPS on a 2020 MacBook. Prove the agentic build pattern + the 5-level teaching ladder.

**One-line pitch:** "A voxel sandbox you play by clicking a link, built autonomously by Claude Code subagents in ~2 weeks."

## 2. Users
- **P1 — The Builder**: clicks a shared link, locks pointer, walks, places 20 / breaks 10 blocks. Should feel satisfying inside 30 seconds. No signup, no install, no tutorial.
- **P2 — Jon as learner**: product-founder iterating via Claude Code. Needs fast re-run, legible subagent diffs, deterministic tests.
- **P3 — Future multiplayer guest** (L5 only): joins a shared world via URL. Not addressed in MVP; architecture leaves netcode seams open.

**Non-personas:** modders (L5), mobile players (L5), minors (COPPA — not targeting, no account/data).

## 3. Scope

### 3.1 In scope (L1 — Day 3 ship)
- Three.js scene renders in browser; no console errors
- First-person camera via `PointerLockControls`
- WASD moves camera; Esc releases pointer
- 60 FPS on 2020 MacBook
- Playwright smoke test green
- Deployed URL (preview acceptable)

### 3.2 In scope (L2 — Day 7 ship)
- Infinite flat world (chunks stream around player)
- Texture atlas (procedural canvas-generated for L2) with 3 block types (grass, dirt, stone)
- Left-click breaks block under crosshair
- Right-click places current block on target face
- Hotbar: number keys 1/2/3 switch block type; UI shows selection
- 8-chunk render radius × 4-chunk vertical at 60 FPS
- Break/place feels instant (<16 ms re-mesh of touched chunk)
- Edits persist as player walks away and returns (in-memory for L2; IDB at L3)
- Correct per-face texturing (grass top ≠ side ≠ bottom)
- Public URL on Cloudflare Pages

### 3.3 Out of scope (deferred to L3+)
- Procedural terrain (hills, caves, biomes)
- Day/night cycle, gravity, jumping, head-bob, collision
- IndexedDB persistence
- Audio
- Mobs, pathfinding, AI
- Multiplayer, netcode
- Modding
- Steam/Itch distribution
- Mobile touch controls

### 3.4 Hard non-goals (never)
- Mojang assets, textures, code, or trademark
- "Minecraft" or "MC" in title/URL/metadata
- Minors as a target audience
- Social features that could become harassment vectors

### 3.5 Accessibility (defer to L3 but don't foreclose)
- Hotbar as DOM overlay (not canvas) — keyboard + tab reachable
- FOV in `design/config.ts` — motion-sensitive sliders in L3
- Head-bob (L3+) ships with off-toggle
- HUD colors: WCAG AA against both daylight and nighttime backgrounds
- No audio-only cues (deaf-accessible by default)

## 4. User Stories (acceptance = passing test)

### L1
- **US-L1-01** Loads <2s, no console errors → `tests/e2e/smoke.spec.ts`
- **US-L1-02** Click → pointer locks, overlay hides → `tests/e2e/smoke.spec.ts`
- **US-L1-03** WASD moves camera → `tests/e2e/controls.spec.ts` (Day 3)
- **US-L1-04** 60 FPS over 10 s walk → `tests/e2e/perf.spec.ts` (Day 3)

### L2
- **US-L2-01** Chunks stream around player → `tests/e2e/streaming.spec.ts` (Day 4)
- **US-L2-02** Left-click breaks block (<50 ms visible) → `tests/e2e/interact.spec.ts` (Day 5)
- **US-L2-03** Right-click places block on target face → same (Day 5)
- **US-L2-04** Number keys switch hotbar selection → `tests/e2e/hotbar.spec.ts` (Day 6)
- **US-L2-05** Walk away + back preserves edits → `tests/e2e/persistence.spec.ts` (Day 6)
- **US-L2-06** 3 block types texture correctly → screenshot baseline (Day 6)

## 5. Scope gates
### P0 bug definition
Crash (console error stops frame loop, blank/white screen) · data loss (edits lost unexpectedly) · controls stop responding · visual corruption blocking play · security issue.

### L2 ship gate (end of Day 7)
- All US pass on prod URL
- ≥3 external testers × 10 min each
- No P0 bugs in last 7 days
- <300 KB gzipped JS bundle
- <2 s LCP on 4G throttled

### L3 entry gate (before starting Level 3)
- ≥10 external testers × 30 min each
- No P0 bugs in last 7 days
- L3 PRD + TSD drafted

## 6. Constraints
- Time: 20-40 focus hours of Jon's attention over 2-3 weeks
- Budget: ~$30 pay-as-you-go OR current Claude plan
- Legal: CC0 or self-made assets only; no Mojang IP
- Platforms: desktop Chrome/Edge/Firefox; mobile deferred to L5

## 7. Open questions
- Final project name: **Chunksmith** (locked)
- Repo visibility: **public** (Jon's choice — no $ cost either way)
- TS vs JS: **TypeScript** (locked)
- Monetization intent for L4-L5: decide at end of L3

## 8. Launch plan
- **Soft (L1):** URL to 5-10 contacts, 1 week iteration, 1-page retro
- **Public (L2):** URL to Jon's X with 90-sec screencap, #vibejam if open, repo flipped public (already is), build-in-public thread
- **Metrics:** CF analytics free tier, session timer in-app, Sentry free tier, Twitter engagement

## 9. Dependencies
- three ^0.187.0 · vite ^8.3.5 · vitest ^5.1.0 · @playwright/test ^1.64.1 · TypeScript
- Cloudflare Pages (Wrangler CLI)
- GitHub repo: github.com/JDC000000/chunksmith
