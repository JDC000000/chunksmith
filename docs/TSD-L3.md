# Chunksmith — Technical Scoping Document (Level 3 Addendum)
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Version:** 1.0
**Companion:** `TSD.md` (L1+L2, unchanged), `PRD-L3.md`

> This document ADDS to `TSD.md`. L1+L2 sections there remain authoritative. All numeric budgets below OVERRIDE their L2 equivalents only where explicitly noted.

## 1. New dependencies

| Package | Version | Size (gz) | Purpose |
|---|---|---|---|
| `simplex-noise` | ^4.0.3 | ~8 KB | Deterministic 2D/3D simplex noise |
| `idb-keyval` | ^6.2.1 | ~1 KB | Promise-based IndexedDB wrapper |

Added to `package.json` on Day L3-2 by `voxel-engine-dev` (IDB) and `terrain-generator` (noise). Both are tree-shakeable.

## 2. Terrain (replaces L2 superflat in `src/gen/terrain.ts`)

### 2.1 Strategy
Multi-octave 2D simplex **heightmap** + 3D simplex **cave carve**. No biomes. No trees. No ores (L4+).

### 2.2 Heightmap formula
```
h(x, z) = baseY
        + amp[0] * n2(x * f[0], z * f[0])
        + amp[1] * n2(x * f[1], z * f[1])
        + amp[2] * n2(x * f[2], z * f[2])
        + amp[3] * n2(x * f[3], z * f[3])

baseY = 32          // mean ground level in world coords
amp  = [16, 8, 4, 2]
f    = [1/256, 1/128, 1/64, 1/32]
```
Four octaves (4 noise channels), decreasing amplitude, doubling frequency. Yields rolling hills ±~30 m, smooth across chunk boundaries.

### 2.3 Cave carve formula
```
cave(x, y, z) = n3(x * fc, y * fc * 2, z * fc) > T_cave
fc     = 1/32
T_cave = 0.58       // ~15% of volume carves
```
Cell is air iff `y > h(x,z)` **OR** (`y <= h(x,z) - 3` AND `cave(x,y,z)`). The `-3` mask prevents caves from breaking the surface near spawn (see PRD-L3 Risk #6).

### 2.4 Block selection
Per cell below surface:
- Topmost 1 layer at `y = floor(h)` → `grass`
- 3 layers below → `dirt`
- Everything deeper → `stone`
- Air if above surface or inside cave

Fixed set from L2 `src/world/blocks.ts`. No new blocks at L3.

## 3. Determinism contract (CRITICAL)

### 3.1 Why this matters
L2's golden hash `4286672581` was a superflat world; it will not survive the L3 generator swap. L3 will have a new golden hash. We must lock a strategy so that the hash is reproducible across machines and CI, not just one dev's laptop.

### 3.2 Rule
**One seed string → one PRNG instance → feeds noise channels in a documented, totally-ordered construction sequence.** No `Math.random` anywhere in `src/world`, `src/gen`, `src/player`.

### 3.3 Construction order (locked)
In `src/gen/terrain.ts`, from a single seed string:
```
1.  rng = cyrb128(seedString)         // 4×32-bit state
2.  rng32 = splitmix32(rng)           // produces uniform floats
3.  noise2D_h0 = createNoise2D(rng32) // heightmap octave 0
4.  noise2D_h1 = createNoise2D(rng32) // heightmap octave 1
5.  noise2D_h2 = createNoise2D(rng32) // heightmap octave 2
6.  noise2D_h3 = createNoise2D(rng32) // heightmap octave 3
7.  noise3D_cave = createNoise3D(rng32) // caves
```
Any change to this order is a terrain-identity break. Treat as a schema migration.

### 3.4 Golden hash test
`tests/unit/terrain.golden.test.ts` samples a canonical slice (origin chunks `(0,0,0)` through `(2,2,2)` = 27 chunks × 4096 cells = 110,592 bytes), hashes with FNV-1a 32-bit, and asserts equality against a locked value. Updated once in Day L3-2 and never again absent an ADR.

### 3.5 Seeds (`src/debug/seeds.ts`, unchanged)
- `DEV_SEED = "chunksmith-dev-001"`
- `E2E_SEED = "chunksmith-e2e-fixed"`
- `DEMO_SEED = "chunksmith-demo-v1"` — the shipped demo

## 4. Physics (new `src/player/physics.ts`, extends `src/player/collision.ts`)

### 4.1 Signatures
```typescript
// src/player/physics.ts (NEW)
export interface PlayerState {
  pos: Vec3;         // AABB center at feet
  vel: Vec3;         // m/s world-space
  grounded: boolean;
  flying: boolean;   // creative flight toggle
}

export function stepPhysics(
  world: World,
  player: PlayerState,
  input: InputState,  // keyboard snapshot
  dt: number,         // seconds, clamped to [1/120, 1/30]
): void;              // mutates player

export function jump(player: PlayerState): void;         // on-ground only; sets vy = JUMP_IMPULSE
export function toggleFlight(player: PlayerState): void; // zeroes vy, flips flying
```

### 4.2 Constants (new, into `design/config.ts`)
```typescript
PHYSICS = {
  GRAVITY_MPS2: 32,          // ADR-0010
  JUMP_IMPULSE_MPS: 9,       // ADR-0010 → ~1.26 m jump apex
  TERMINAL_VELOCITY_MPS: 54,
  STEP_UP_MAX_BLOCKS: 1,
  FLIGHT_SPEED_MULT: 2,
  SUBSTEP_WHEN_DT_OVER: 1/30, // sub-step when frame rate dips
}
```

### 4.3 Swept-AABB — axis order
X → Z → Y. Y last. This is what makes 1-block step-up slide smoothly instead of catching. See ADR-0010 and existing ADR-0005.

### 4.4 Sub-stepping
If `dt > 1/30`, split into N = `ceil(dt / (1/60))` sub-steps. Guarantees no tunneling at reasonable speeds. Covered by `tests/unit/physics.test.ts` tunneling case at v=100 m/s.

### 4.5 Jump + flight input
- Space pressed, grounded, not flying → `jump()`
- Space double-tap (two presses within 300 ms) → `toggleFlight()`
- While flying: WASD moves horizontally, Space ascends, Shift descends, gravity ignored

### 4.6 Grounded test
AABB bottom within 0.05 m of a solid cell AND `vel.y <= 0`. Latched false during the first 2 frames after `jump()`.

## 5. Persistence (`src/persist/idbStore.ts`, new file)

### 5.1 Schema
```
Keyval key:   `chunk:${worldId}:${cx},${cy},${cz}`
Keyval value: Uint8Array (chunk voxels, 4096 bytes)
Meta key:     `meta:${worldId}`
Meta value:   { seed: string, version: 1, lastSaved: number }
```
`worldId` for L3 is the literal string `"world-0"` (single implicit save; PRD §8 flagged).

### 5.2 Only EDITED chunks save
`World.applyBlockChange()` marks the touched chunk `dirty`. A debounced flusher (5 s, inside `requestIdleCallback`) writes all dirty chunks and clears their dirty flag. Unedited chunks are never persisted and are regenerated from seed on next load. This caps IDB to ≤ 50 MB for even heavy sessions.

### 5.3 API
```typescript
// src/persist/idbStore.ts
export async function loadChunk(worldId: string, key: string): Promise<Uint8Array | null>;
export async function saveChunk(worldId: string, key: string, voxels: Uint8Array): Promise<void>;
export async function loadMeta(worldId: string): Promise<Meta | null>;
export async function saveMeta(worldId: string, meta: Meta): Promise<void>;
export async function wipeWorld(worldId: string): Promise<void>;
export function scheduleFlush(worldId: string, world: World): void; // debounced
```

### 5.4 Load order (per chunk request)
1. Check IDB for `chunk:${worldId}:${key}` — if present, decode into `Chunk.voxels` and return.
2. Else generate from seed via `src/gen/terrain.ts` and return. (Not written back; only `applyBlockChange` writes.)

### 5.5 Version bump + migrator
`meta.version = 1` at L3 ship. Future schema breaks increment and ship a one-time migrator keyed on `meta.version`. If `meta.version > currentVersion` detected on load, surface a warning and refuse to overwrite (forward compatibility fail-safe).

### 5.6 Chunk-delta encoding (L3 ships raw)
L3 saves full 4096-byte chunk voxels. Delta encoding (store only changed-cell list) is an L4 optimization — gated by observed IDB bytes/user. Document the hook now; don't build it.

## 6. Day/night (`src/world/time.ts`, new file)

### 6.1 Model
```typescript
export interface TimeState {
  timeOfDay: number;  // [0, 1); 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset
}

export function tickTime(state: TimeState, dt: number): void;
// advances timeOfDay by dt / CYCLE_SECONDS, modulo 1
```

### 6.2 Constants (into `design/config.ts`)
```typescript
WORLD_TIME = {
  CYCLE_SECONDS: 600,    // 10 min full day → ADR-0012
  INITIAL_TOD: 0.3,      // soft morning on first load
  DAY_SKY: [0.52, 0.72, 1.0],   // sRGB
  NIGHT_SKY: [0.03, 0.04, 0.12],
}
```

### 6.3 Sun direction
```
sunDir = normalize(vec3(cos(t * 2π), sin(t * 2π) * 0.9 + 0.1, 0.3))
```
The `*0.9 + 0.1` keeps the y-component in `[-0.8, 1.0]`, so even "midnight" has a slight downward bias and avoids degenerate dot(normal, sunDir)=0 cases.

### 6.4 Ambient tint curve
```
daylight = clamp01(sin(t * 2π) * 0.5 + 0.5)   // peaks at noon, 0 at midnight
ambient  = mix(0.08, 0.6, daylight)
sunColor = mix(vec3(0.3, 0.4, 0.7), vec3(1.0, 0.95, 0.85), daylight)
skyColor = mix(NIGHT_SKY, DAY_SKY, daylight)
```

## 7. Material changes

### 7.1 New uniforms on `chunkMaterial` (ShaderMaterial)
```glsl
uniform float uTimeOfDay;      // [0,1)
uniform vec3  uSunDir;          // normalized
uniform vec3  uSunColor;
uniform float uAmbient;
uniform vec3  uSkyColor;        // for scene background too
```
Fragment shader modulates per-face lighting as `albedo * (uAmbient + max(0, dot(normal, uSunDir)) * uSunColor)`. Normals are known from face index (6 cube faces, cheap LUT in vertex shader).

### 7.2 Scene background
`scene.background = new Color(uSkyColor)` updated once per frame from `TimeState`.

### 7.3 Fog (optional, if perf allows)
Linear fog near=0, far=`CHUNK_SIZE * RENDER_RADIUS_CHUNKS * 0.9` tinted to `uSkyColor` → masks the chunk-edge pop and feels atmospheric. L3-7 polish task.

## 8. Performance budgets (deltas from L2)

| Metric | L2 target | L3 target | Note |
|---|---|---|---|
| Steady-state FPS | 60 | 60 | Unchanged |
| Physics step (CPU) | n/a | ≤ 1 ms | New budget |
| Terrain gen per chunk (cold) | ≤ 100 ms | ≤ 100 ms | Was superflat (near 0 ms); now real noise |
| IDB flush per debounce | n/a | ≤ 100 ms, in `requestIdleCallback` | New |
| Shader cost delta (day/night) | n/a | ≤ 0.5 ms/frame | Measured on 2020 MBP |
| Initial JS bundle (gz) | ≤ 300 KB | ≤ 400 KB | Headroom for noise + IDB |
| Memory steady-state | ≤ 400 MB | ≤ 400 MB | Unchanged |

CI gates still: budget × 1.25 → warning, × 1.5 → fail.

## 9. Test strategy additions

- **Unit (Vitest):**
  - `terrain.test.ts` — height variance, cave fraction, surface mask near spawn
  - `terrain.golden.test.ts` — FNV-1a hash of 27-chunk sample
  - `physics.test.ts` — gravity, jump apex, step-up, tunneling at 100 m/s, flight toggle
  - `dayNight.test.ts` — tick 600 s, tOD returns to start
  - `regen.test.ts` — same seed + empty IDB → byte-identical chunks across runs
  - `idbStore.test.ts` — save/load roundtrip, debounce coalescing (fake timers)
- **E2E (Playwright):**
  - `walk.spec.ts` — 10 s auto-walk on hills; no clipping, no fall-through
  - `flight.spec.ts` — Space double-tap, verify `window.__game.player.flying`
  - `persistence-idb.spec.ts` — place 3 blocks → reload → blocks remain
  - `dayNight.spec.ts` — screenshot luminance at noon vs midnight
- **Perf:** physics tick + chunk-gen histogram over 10 s walk, p95 under budget.

## 10. Risk register (deltas; see PRD-L3 §5 for full table)
- Golden-hash drift (new) — §3 strategy mitigates
- Spawn tunneling into cave (new) — §2.3 surface mask mitigates
- Shader uniform drift breaks baselines (new) — e2e baselines regenerate once on L3-3

## 11. Decisions log (L3 additions)
- ADR-0009 Terrain (hills + caves) — new file
- ADR-0010 Jump feel + step-up — new file
- ADR-0011 Persistence (IDB chunk-delta) — new file
- ADR-0012 Day/night cycle — new file
