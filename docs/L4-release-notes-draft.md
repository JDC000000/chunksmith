# Chunksmith L4 — "The world has texture"

Draft release notes for Jon's build-in-public thread + launch post. Written for a mixed audience (voxel-game folks + AI-build-in-public folks). Edit, cut, remix as needed.

---

## One-line pitch
Chunksmith L4 ships biomes, block lighting, inventory, and 6 new blocks — the level that turns a voxel toybox into a place.

---

## Twitter/X thread draft (6 posts)

**1/**
Chunksmith L4 is live.

Three biomes. A real inventory. Torches that cast real light into caves you dig. Water that catches the sunset.

Built with Claude in Cowork — subagents, parallel lanes, zero touch of my keyboard after I locked the widgets.

→ chunksmith.joncartwright00.workers.dev

[screencap: biome border at sunrise]

**2/**
What L4 adds:
• 3 biomes (plains / forest / mountains) with noise-mixed soft transitions
• Block lighting — torches, skylight, falloff through walls
• 27-slot backpack UI with drag/drop, 64-stack blocks
• 6 new blocks: wood, leaves, torch, water, sand, snow
• Cosmetic water in plains depressions (no sim, pretty ponds)

[screencap: torch-lit cave]

**3/**
How it got built: five parallel Claude subagents, each in its own file lane:
• terrain-generator → biome function + trees
• voxel-engine-dev → lighting system + new block types + player persistence
• ui-dev → backpack panel + drag/drop
• game-designer → every tunable constant + the widget-lock widget
• planner → PRD-L4 + day-by-day plan

I locked 5 widget decisions (ADRs 0013-0017) and walked away.

**4/**
Favorite moment: the game-designer agent re-tuned four L1-L3 constants to make nights darker so torches would earn their screen time. I asked for "creative, contemporary, a bit fun" and got a flicker-rate knob for the torch shader.

(The specific one: 5.5 Hz. Any faster is a strobe. Any slower is a lamp.)

**5/**
What's deferred to L5:
• Mobs
• Fluid simulation (water flows, pumps, dams)
• Crafting
• Audio
• Multiplayer netcode (the applyBlockChange gate is already ready for it)

L5 is where this becomes a real game. L4 is where it becomes a real place.

**6/**
If you playtest, I want to hear:
• Did biome transitions read "soft" or "map-line"?
• Did you place a torch and understand what it did?
• Would you come back tomorrow for 20 more minutes?

20 min, Chrome, link above. DM feedback or drop a reply.

(Playtest script if you want to be thorough: [link to L4-ship-gate.md])

---

## LinkedIn draft (long-form, 300-400 words)

**Shipped Chunksmith L4 today — biomes, lighting, inventory. Built it with Claude in Cowork without touching my keyboard.**

Chunksmith is a browser voxel sandbox I started as a learning project to see how far AI-pair-programming has come. L1 was "scene renders." L2 was "chunks + place/break + deploy." L3 was "it feels like a world — hills, caves, day/night, persistence."

L4 was the ambitious one: biomes, block lighting, inventory UI, new block types. In the voxel-sandbox genre, that's the step between "tech demo" and "actually a game."

Here's what I actually did:
1. Had Claude's planner subagent draft the PRD and day-by-day plan.
2. Had Claude's game-designer subagent pick values for 5 open design decisions ("creative, contemporary, a bit fun" — that was my entire design brief).
3. Spawned four build subagents in parallel on disjoint file scopes.
4. Walked away.

The agents returned with a working lighting system, a working biome generator, a working inventory UI, and 24 new config constants tuned to feel right. I integrated the pieces, verified the test suite, pushed.

**The surprising part:** when I asked the game-designer for the widget-decisions, it also proposed re-tuning four EXISTING constants — making nights darker, mountains taller, spawn-on-grass instead of spawn-flying. I pushed back once, asking it to decide. It did. The ambient-light-floor change alone was the difference between "lit cave" and "cave worth lighting."

**What I learned:**
• Subagents on disjoint file scopes is the parallelism move. Four agents, four lanes, zero merge conflicts.
• ADRs matter. Every subagent read the ADRs before writing code; the ADRs let me not have to be in the loop.
• The game-designer agent is the one that makes the game feel like a game. The other agents make it work. These are different crafts.

Live site: chunksmith.joncartwright00.workers.dev
Repo (public): github.com/JDC000000/chunksmith
Playtest script if you want to be thorough: [link]

Taking feedback. Especially: did biome transitions read "soft" or "map-line"? That's the one I'm least sure about.

---

## 90-sec screencap script (for the ship post)

Shot list for the obligatory video:
1. **0:00-0:05** — Fade in on a hilltop at sunrise. Three biomes visible from one spot.
2. **0:05-0:15** — Walk down into the forest. Trees pass. Grass transitions to leaf-litter.
3. **0:15-0:25** — Reach a plains edge. See a lake (water voxels catching the pink sky).
4. **0:25-0:40** — Pivot and walk toward a mountain. Peak comes into view as player gets closer.
5. **0:40-0:55** — Dig straight down into stone. Cave opens up. It's dark.
6. **0:55-1:05** — Press E, select torch from hotbar. Place torch. Light propagates into the cave.
7. **1:05-1:15** — Place 3 more torches. Walk away. Look back — the cave is a lit room now.
8. **1:15-1:25** — Fast-forward to night. Return to the lit cave entrance from outside. Visible glow against black.
9. **1:25-1:30** — Cut to title card: "Chunksmith L4 — the world has texture. chunksmith.joncartwright00.workers.dev"

Record in Chrome at 1920×1080. Use OBS or built-in screen recorder. Audio off (no sound at L4; defer to L5).

---

## Changelog entry (for GitHub release)

```
## Chunksmith L4 — The world has texture (2026-11-XX)

### Added
- 3 biomes: plains, forest, mountains (noise-mixed weight blending, ADR-0013)
- Block lighting: skylight + torch propagation via incremental dirty-queue BFS (ADR-0014)
- 27-slot backpack inventory UI with drag/drop + 64-stack blocks (ADR-0015)
- 6 new block types: wood, leaves, torch, water, sand, snow (ADR-0016, ADR-0017)
- `playerState` IDB record — hotbar + backpack + position survive refresh
- Trees in forest biome (4 per 16×16 chunk)
- Snow cap above y=72
- Cosmetic water voxels in plains depressions (no sim)
- Flickering torch shader (5.5 Hz perlin fragment-shader flicker, 0.06 amplitude)

### Changed
- `DAY_NIGHT.AMBIENT_FLOOR` 0.35 → 0.18 (nights darker so torches earn screen time)
- `DAY_NIGHT.AMBIENT_RANGE` 0.25 → 0.42 (preserves day peak at 0.60)
- `WORLD.VERTICAL_RADIUS_CHUNKS` 4 → 6 (mountains need vertical headroom)
- `PHYSICS.SPAWN_FLYING` true → false (L4 spawns on grass; walk in instead of float; ADR-0018)
- Storage schema v1 → v2 (voxel bytes + light bytes concatenated; lazy migration)

### Fixed
- (none — L3 pre-ship work was clean)

### Deferred to L5
- Mobs / NPCs
- Fluid simulation
- Crafting / recipes
- Audio
- Save slots / named worlds
- Multiplayer netcode
```
