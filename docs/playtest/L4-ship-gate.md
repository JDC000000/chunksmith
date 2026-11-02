# L4 Ship-Gate Playtest Script
**Target:** 10+ external testers × 20 min each · Pass bar in `PRD-L4.md` §4
**Setup:** Share live URL (`chunksmith.joncartwright00.workers.dev`), ask tester to open in Chrome, click to begin.

> Hand testers this script in a doc or comment field. The feedback template is at the bottom — ask them to paste responses back.

## Section A — First 60 seconds (unprompted)
Open the game. Don't tell the tester anything. Watch them.

- [ ] Did they figure out how to look around? (click to lock cursor)
- [ ] Did they figure out they could walk? (WASD)
- [ ] Did they notice the controls hint toast?
- [ ] Did they see different-looking terrain in different directions?
- [ ] Did they comment on the sky changing?

**Metric:** "noticed biome variety within 60s" — target ≥ 7/10 testers.

## Section B — Guided tour (3 min)
Tell them: "Try walking around for 3 minutes. Press E if you want to see your inventory. Press F to toggle flight if you want."

- [ ] Walks across a biome border → do transitions read as "soft" or "map lines"?
- [ ] Encounters trees in the forest → visual acceptable?
- [ ] Reaches a mountain → does the peak draw in from distance or pop in?
- [ ] Finds water (plains biome depressions) → tries to walk into it, no drowning, no slowdown
- [ ] Opens backpack with E → closes with E → open/close animation smooth?
- [ ] Toggles flight with F → notices the toast, flies, lands, walks

## Section C — Build-interaction loop (5 min)
"Now break and place blocks for 5 minutes. Try the hotbar numbers 1-9. Try the backpack."

- [ ] Breaks a tree → logs appear in inventory
- [ ] Places a torch at night → sees light propagate into neighboring cells
- [ ] Breaks the torch → sees light recede
- [ ] Drags a stack from backpack to hotbar
- [ ] Drops a stack from hotbar to backpack
- [ ] Right-clicks on a stack during drag → splits (half picked up)
- [ ] Places water voxel → notes it stays put (no flow at L4)
- [ ] Places 65+ of same block in one slot → stack caps at 64, overflow goes to next slot

**Metric:** "placed at least one torch and understood what it did" — target ≥ 8/10.

## Section D — Persistence probe (2 min)
"Place a stack of 32 stones in your backpack. Note where they are. Refresh the page. Check again."

- [ ] After refresh: 32 stones in same slot
- [ ] After refresh: previously placed blocks are still there
- [ ] After refresh: time-of-day picks up where it left off? (Known gap at L4 — flag if a tester complains)

## Section E — Edge-case probes (3 min)
"Try to break the game."

- [ ] Dig straight down for 60s. Fall into a cave. Does lighting read as "it feels like a cave"?
- [ ] Build a tower of 20 blocks. Walk off. Fall is manageable (no instant death)
- [ ] Place 50 torches in a cluster. FPS holds. All torches lit.
- [ ] Open backpack during fall → does the game pause gracefully or does the player keep falling?
- [ ] Esc to release pointer during flight → recoverable?

## Section F — Feel questions (3 min, verbal or written)
Ask the tester (do NOT bias):
1. "If you had to describe this game to a friend in one sentence, what would you say?"
2. "What one thing stood out as best?"
3. "What one thing felt most frustrating or confusing?"
4. "Would you come back tomorrow for 20 more minutes?"
5. "What would make you tell someone else about this?"

## Section G — Crash probes (2 min)
- [ ] DevTools console shows zero `error` lines after 20 min
- [ ] DevTools memory tab shows < 500 MB after 20 min
- [ ] Alt-tab out for 60s, alt-tab back. Game resumes cleanly.
- [ ] Open the game in a second browser tab. First tab still works. (L5 netcode will unify these; at L4 they're independent worlds.)

## Section H — Jon-side acceptance (not shared with tester)
After the tester hands back:
- [ ] All L1-L3 playtest items still pass
- [ ] All US-L4-01..14 user stories observed working at least once across the cohort
- [ ] At least 7/10 testers said yes to "come back tomorrow"
- [ ] At least 5/10 testers used a word like "beautiful" / "pretty" / "cool-looking" unprompted
- [ ] Zero P0 bugs in the aggregate feedback (P0 = game-breaking, data-loss, repro'd by ≥ 2 testers)

## Ship signal (from PRD-L4)
> 3 biomes you can see from a hilltop, torch casts real light into a cave you dug, E opens a backpack you actually use, ≥10 testers × 20 min say "it feels different now," no P0 in 7 days.

---

# Feedback form template

Give to each tester to fill in (plain text or paste into email/DM).

```
=== Chunksmith L4 playtest — <tester name>, <date> ===

Device + browser:
Connection:
Minutes played:

Section A (first impressions, unprompted):
  Figured out look (click): [Y/N, time to figure out]
  Figured out walk (WASD): [Y/N, time to figure out]
  Noticed biome variety: [Y/N]
  Noticed sky changing: [Y/N]

Section B (guided tour):
  Biome transitions feel: [soft / map-lines / didn't notice]
  Trees look: [good / weird / didn't notice]
  Mountain draw-in: [smooth / pop-in / didn't notice]
  Water interaction: [walked through / stuck / didn't try]
  E backpack animation: [smooth / jarring / didn't try]
  F flight toggle: [found it / didn't / was confusing]

Section C (build loop):
  Broke tree → logs in inventory: [Y/N]
  Placed torch in dark → saw light spread: [Y/N / didn't try]
  Broke torch → saw light recede: [Y/N / didn't notice]
  Drag between hotbar + backpack: [works / weird / didn't try]
  Right-click split: [works / didn't find it / didn't try]
  Water placement: [stayed put / weird / didn't try]
  Stack cap at 64: [observed / didn't test]

Section D (persistence):
  Backpack stack survived refresh: [Y/N]
  Placed blocks survived refresh: [Y/N]

Section E (edge cases):
  Cave lighting read as cave: [Y/N]
  Fall from 20 blocks survived: [Y/N]
  50-torch cluster FPS held: [Y/N / didn't test]

Section F (feel):
  One-sentence description:

  Best thing:

  Most frustrating / confusing:

  Come back tomorrow for 20 more min? [Y/N, why]

  Would tell a friend if:

Section G (crash probes):
  Console errors after 20 min: [count]
  Memory after 20 min: [MB]
  Alt-tab recovery: [clean / glitchy / crashed]

Overall rating: [1-10]
```
