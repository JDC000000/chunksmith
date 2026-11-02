# Chunksmith — Technical Scoping Document (Level 4 Addendum)
**Owner:** Jon Cartwright
**Date:** 2026-11-02
**Version:** 1.0 (drafted after widget lock, before Day L4-2 implementation)
**Companion:** `TSD.md` (L1+L2), `TSD-L3.md` (L3), `PRD-L4.md`

> This document ADDS to `TSD.md` and `TSD-L3.md`. L1-L3 sections there remain authoritative. All numeric budgets below OVERRIDE their L1-L3 equivalents only where explicitly noted.

## 1. New dependencies
**None.** L4 reuses `simplex-noise` (from L3) for biome weights and `idb-keyval` (from L3) for the new `playerState` IDB record. No new npm packages are added at L4.

## 2. Biomes (ADR-0013, `src/gen/biomes.ts`)

### 2.1 Strategy
Three biomes — PLAINS, FOREST, MOUNTAINS — selected by a single low-frequency 2D simplex field. Soft noise-mixed blend band around each boundary. Deterministic from `(seed, x, z)`.

### 2.2 Weight function
```
w(x, z) = n2(x * BIOMES.WEIGHT_NOISE_SCALE, z * BIOMES.WEIGHT_NOISE_SCALE)   // -1..1

if w < -0.33: biome = PLAINS
elif w <  0.33: biome = FOREST
else:           biome = MOUNTAINS

strength = clamp01(distance_to_nearest_band_edge / BIOMES.TRANSITION_SOFTNESS_BLOCKS)
```

### 2.3 Surface height per biome
```
plainsH(x,z)    = baseY + 4*n2(x/64, z/64) * PLAINS_ROUGHNESS
forestH(x,z)    = baseY + 8*n2(x/64, z/64)
mountainH(x,z)  = baseY + 24*n2(x/128, z/128) * MOUNTAIN_HEIGHT_MULT

blendedH = weighted_mix(plainsH, forestH, mountainH, strength)
```

### 2.4 Features
- **Forest trees**: `BIOMES.FOREST_TREES_PER_CHUNK = 4` per 16×16 chunk; positions deterministic from `(seed, chunkCoord, treeIndex)` via `splitmix32`
- **Snow cap**: any cell with `y > BIOMES.SNOW_CAP_Y = 72` gets `BLOCKS.snow` as the top surface regardless of biome
- **Water**: plains biome fills depressions below `WATER.SEA_LEVEL_Y = 32` with `BLOCKS.water` (no sim)

### 2.5 Golden hash
`terrainAt("chunksmith-dev-001", 0, 0, 0)` yields a NEW hash at L4. The L3 hash `882683694` is intentionally retired. New value locked in `tests/unit/terrain.test.ts` by the Day L4-2 agent.

## 3. Block lighting (ADR-0014, `src/world/lighting.ts`)

### 3.1 Storage layout
Per-chunk `light: Uint8Array(16 * 16 * 16)` — one byte per cell:
```
byte = (skylight << 4) | blockLight
         ^0..15           ^0..15
```
Same index math as `voxels`: `i = x + z*16 + y*256`. Memory per chunk doubles from 4 KB (voxels) to 8 KB (voxels + light).

### 3.2 Propagation algorithm (dirty-queue BFS)
```
LightingSystem {
  dirty: Array<{ chunk: Chunk, x: number, y: number, z: number }>
  budget: LIGHTING.DIRTY_QUEUE_BUDGET_PER_FRAME = 2000

  markDirty(chunk, lx, ly, lz)        // enqueue
  step()                              // pop up to `budget` cells, propagate 6-way
  removeLight(chunk, lx, ly, lz)      // de-light cascade for break-torch
}
```
Called once per frame from `main.ts` after physics. If the queue is non-empty after `budget` pops, work continues next frame — graceful degradation.

### 3.3 Falloff
Neighbor cell receives `light - FALLOFF_PER_BLOCK (= 1)` through air. Through `isTransparent` blocks (water, leaves): `-2`. Through solid: zero propagation (hard stop).

### 3.4 Perf budget
- Place-torch cascade (20-block radius): ≤ 4 ms on mid hardware
- 500-torch cave teardown: cascade spans multiple frames; player sees "lighting is catching up" for ≤ 1 s, no stalls

### 3.5 Save path
Light bytes serialize to IDB alongside voxels in the v2 chunk-delta format. See §9.

## 4. Inventory + player state (ADR-0015, `src/world/playerState.ts`)

### 4.1 Shape
```typescript
interface InventoryStack { blockId: number; count: number; }
interface PlayerState {
  version: number;                                 // INVENTORY.PLAYER_STATE_VERSION
  hotbar: Array<InventoryStack | null>;            // length 9
  backpack: Array<InventoryStack | null>;          // length 27
  selectedHotbarSlot: number;                      // 0..8
  flying: boolean;
  position: { x: number; y: number; z: number };
  yawPitch: { yaw: number; pitch: number };
}
```

### 4.2 IDB key
```
<PERSISTENCE.WORLD_ID><INVENTORY.PLAYER_STATE_KEY_SUFFIX>
= "world-0:player"
```
JSON-encoded blob. Not binary — small enough (~1 KB) that introspection in DevTools matters more than parse speed.

### 4.3 Debounce + flush
Writes join the existing `ChunkPersistence` idle loop via a "player" sentinel key in its pending set. `beforeunload` flushes with the chunk writes.

### 4.4 Schema version
`PLAYER_STATE_VERSION = 1`. A `loadPlayerState` call that reads a mismatched version returns `undefined`, forcing a fresh `defaultPlayerState()`.

## 5. Water (ADR-0016, cosmetic voxel)

### 5.1 Block definition
`BLOCKS.water = 7`. Properties: `isSolid=false`, `isTransparent=true`, `emission=0`, `opacity=WATER.OPACITY`.

### 5.2 Rendering
Second transparent-face pass in the mesher. Vertex shader applies `WAVE_AMPLITUDE_BLOCKS * sin(time * WAVE_HZ + worldPos.xz)` to top faces only. Fragment shader lerps albedo with `WATER.TINT_RGB` at `WATER.OPACITY`.

### 5.3 Physics
`collision.ts` early-outs on `blockId === BLOCKS.water` the same way it does on `BLOCKS.air`. No drowning. No slowdown. Player's head going underwater has no gameplay effect at L4 (full-screen tint deferred to L4-6 polish).

## 6. Torch rendering (ADR-0017, shader channel)

### 6.1 Mesher output
Each vertex gets two new u8 attributes:
```
attribute float aSkylight;   // 0..15, from light byte hi-nibble
attribute float aBlockLight; // 0..15, from light byte lo-nibble
```

### 6.2 Fragment shader (`src/render/chunkMaterial.ts`)
```glsl
float sky = vSkylight / 15.0;
float blk = vBlockLight / 15.0;
float flk = 1.0 + LIGHTING.TORCH_FLICKER_AMPLITUDE *
            (noise(vWorldPos.xz * 0.5 + uTime * LIGHTING.TORCH_FLICKER_HZ) - 0.5) * 2.0;
float light = max(sky, max(LIGHTING.TORCH_BRIGHTNESS_MIN * blk, blk) * flk);
gl_FragColor.rgb = albedo * light * sunContribution(uSunDir, normal);
```
Flicker is pure fragment-shader perlin — no dirty-queue cost, no CPU work. `TORCH_FLICKER_AMPLITUDE ≤ 0.1` is the a11y / motion-sickness ceiling.

### 6.3 Composition with L3 day/night
L3's `uSunDir` + `uAmbient` + `uSunIntensity` continue to drive sun contribution. Block light composes multiplicatively via `max()` so a torch always wins against a dark ambient and a lit day always wins against a dark torch.

## 7. New block types (`src/world/blocks.ts`)

| ID | Name | isSolid | isTransparent | emission | opacity | Notes |
|---|---|---|---|---|---|---|
| 0 | air | false | true | 0 | 0 | unchanged |
| 1 | grass | true | false | 0 | 1 | unchanged |
| 2 | dirt | true | false | 0 | 1 | unchanged |
| 3 | stone | true | false | 0 | 1 | unchanged |
| 4 | wood | true | false | 0 | 1 | NEW (L4) |
| 5 | leaves | true | true | 0 | 0.7 | NEW; propagates light at `FALLOFF_PER_BLOCK + 1` |
| 6 | torch | false | true | 14 | 0 | NEW; emits `LIGHTING.TORCH_LIGHT_LEVEL` |
| 7 | water | false | true | 0 | 0.55 | NEW; cosmetic (ADR-0016) |
| 8 | sand | true | false | 0 | 1 | NEW |
| 9 | snow | true | false | 0 | 1 | NEW |

## 8. Storage schema v2 (`src/world/storage.ts`)

`WORLD_VERSION` bumps `1 → 2`.

### 8.1 v2 chunk-delta key format
```
chunk:v2:<worldId>:<cx,cy,cz>
value = Uint8Array(8192) = voxels(4096) || light(4096)   // concatenated
```

### 8.2 v1 → v2 migration
`loadChunk` reads v2 first. If v2 missing but v1 present:
- Read v1 bytes (voxels only, 4096 B)
- Set `light = new Uint8Array(4096)` (all zeros — forces re-propagation on next lighting step)
- Return the migrated chunk; on next save it writes as v2 (lazy migration)

### 8.3 Backward compatibility
`clearWorld` scans both v1 AND v2 prefixes to catch split-version worlds. Adversarial tests in `tests/unit/storage.test.ts` already cover prefix isolation and version mismatch — adapted for v2.

## 9. Perf budgets (OVERRIDE L3 where noted)

| Scope | Budget | Notes |
|---|---|---|
| Lighting step | 4 ms / frame | ADR-0014 cap on dirty-queue work |
| Mesher (per chunk, with light attrs) | ≤ 2 ms | +0.5 ms vs L3 for the light-attribute pass |
| Chunk IDB load (v2, 8 KB) | ≤ 1 ms | double v1's 0.5 ms, acceptable |
| Inventory save | ≤ 0.5 ms | <1 KB JSON blob |
| Shader fragment cost | +0.3 ms | perlin flicker + light max() |
| **Headline:** 60 FPS p50 at radius=8,6 | hold the line | VERTICAL_RADIUS tune pending Jon's call |

## 10. Testing surface

| User story | Test file | Owner subagent |
|---|---|---|
| US-L4-01..04 | `tests/unit/biomes.test.ts`, `tests/unit/trees.test.ts` | terrain-generator |
| US-L4-05..07 | `tests/unit/lighting.test.ts` | voxel-engine-dev |
| US-L4-08 | `tests/unit/torchShader.test.ts` (unit) + `tests/e2e/torchlight.spec.ts` (e2e) | voxel-engine-dev (unit), main-session (e2e) |
| US-L4-09..11 | `tests/e2e/inventory.spec.ts` | ui-dev |
| US-L4-12 | `tests/unit/playerState.test.ts` (unit) + `tests/e2e/inventory-idb.spec.ts` (e2e) | voxel-engine-dev (unit), ui-dev (e2e) |
| US-L4-13 | `tests/unit/blocks.test.ts` (unit) + `tests/e2e/newBlocks.spec.ts` (e2e) | voxel-engine-dev (unit), main-session (e2e) |
| US-L4-14 (no L1-L3 regression) | existing specs | main-session verifies |

## 11. Known omissions (deferred to L5+)

- Mobs, NPCs, pathfinding, AI
- Fluid simulation (water flow + drain)
- Crafting / recipe grid
- Audio (ambient, step, break, place)
- Save slots, named-world UI
- Multiplayer netcode (L5 scope)
- Mobile touch controls
