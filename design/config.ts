// Game-designer's domain. All numbers that affect feel live here.
// Rename with units in the identifier. Comment the WHY, not the WHAT.

export const PLAYER = {
  /** Walking speed. 5 feels brisk but not Olympic (voxel-sandbox norm is ~4-5). Jon-tunable. */
  MOVE_SPEED_MPS: 5,
  /** How far the player can reach to break/place a block. 6 is the voxel-sandbox default. */
  REACH_BLOCKS: 6,
  /** How tall the player AABB is. 1.8 = adult-ish; L3+ uses this for collision. */
  AABB_HEIGHT_BLOCKS: 1.8,
  /** How wide the player AABB is. 0.6 fits through 1-wide corridors (voxel-sandbox convention). */
  AABB_WIDTH_BLOCKS: 0.6,
};

export const CAMERA = {
  /** FOV in degrees. 75 feels right for 1st-person voxel. Motion-sensitive players want this exposed to a user slider in L3+. */
  FOV_DEG: 75,
  /** Near clip plane. Any closer and face z-fighting at the player's own edges. */
  NEAR: 0.1,
  /** Far clip. Must be >= 8 chunks * 16 blocks = 128 for L2. Use 1000 to leave room for L3 vistas. */
  FAR: 1000,
};

export const WORLD = {
  /** Chunk size cube. ADR-0002 locks this in — do NOT change without ADR. */
  CHUNK_SIZE: 16,
  /** How many chunks around the player are loaded horizontally. 8 is the voxel-sandbox default (128 blocks). */
  RENDER_RADIUS_CHUNKS: 8,
  /** Vertical chunks loaded. 4 enough for L2 superflat; L3 raises for mountains. */
  /** 2026-11-02 L4 re-tune (game-designer): 4→6 so peaks above SNOW_CAP_Y=72 don't pop in at MOUNTAIN_HEIGHT_MULT=2.4. +50% vertical streaming load — within L4 perf gate. */
  VERTICAL_RADIUS_CHUNKS: 6,
};

export const DEBUG = {
  /** Toggle F3 overlay in dev builds. */
  SHOW_STATS: true,
  /** Toggle chunk-border wireframe via ?debug=1 URL param. */
  SHOW_CHUNK_BORDERS_FLAG: "debug",
};

// === L3 ===

export const DAY_NIGHT = {
  /** Full cycle in seconds. 600 = 10 min, voxel-sandbox genre default. Per widget. */
  PERIOD_SEC: 600,
  /** Fresh page load starts at this timeOfDay ∈ [0,1). 0.5 = noon per widget. */
  START_TIME_OF_DAY: 0.5,
  /** Ambient light floor + range. Light = AMBIENT_FLOOR + AMBIENT_RANGE * clamp(sunY). */
  /** 2026-11-02 L4 re-tune (game-designer): 0.35→0.18 so torches earn their screen time in caves at night (US-L4-08 ≥60/255 delta). */
  AMBIENT_FLOOR: 0.18,
  /** 2026-11-02 L4 re-tune: 0.25→0.42 so noon stays at 0.60 (0.18+0.42) while nights deepen. MUST move with AMBIENT_FLOOR or days go flat. */
  AMBIENT_RANGE: 0.42,
  /** Sun direction curve shape — see src/render/dayNight.ts. */
  SUN_Y_FLOOR: 0.05,
  SUN_Z_TILT: 0.3,
  /** Sky color endpoints (0..1 lerped by dayness). */
  DAY_SKY_RGB:   [0.53, 0.81, 0.92] as const,
  NIGHT_SKY_RGB: [0.05, 0.07, 0.16] as const,
};

export const PERSISTENCE = {
  /** Debounced IDB flush interval in requestIdleCallback. */
  FLUSH_INTERVAL_MS: 5000,
  /** Single world ID per widget decision. L4+ can add multi-world UI. */
  WORLD_ID: "world-0",
};

export const PHYSICS = {
  /** Downward acceleration in m/s². 32 gives voxel-sandbox-feel jump arcs (apex ≈ 1.27 blocks with JUMP=9). */
  GRAVITY_MPS2: 32,
  /** Jump impulse. 9 m/s with gravity 32 → apex ≈ 1.27 m (just over 1 block). */
  JUMP_VELOCITY_MPS: 9,
  /** Terminal velocity clamp on fall. */
  TERMINAL_VELOCITY_MPS: 50,
  /** Max step-up (blocks). 1 = standard voxel-sandbox. */
  STEP_UP_BLOCKS: 1,
  /** Flight toggle key default = 'KeyF'. Space/Shift always available for flight motion. */
  FLIGHT_TOGGLE_KEY: "KeyF",
  /** Multiplier on MOVE_SPEED while in flight mode. */
  FLIGHT_SPEED_MULT: 2,
  /** New players spawn with flight on per widget — avoids first-touch fall. */
  /** 2026-11-02 L4 re-tune (game-designer, see ADR-0018): true→false. L3 rationale ("avoid first-touch fall on empty superflat") no longer holds — L4 spawns on generated grass terrain. Walking in is the correct first impression; flight still F away. */
  SPAWN_FLYING: false,
};

// =============================================================================
// === L4 widget-locked constants (ADRs 0013-0017, 2026-11-02) ===
// Per game-designer handback — Jon directive "creative, contemporary, a bit fun".
// See docs/decisions/ADR-00{13..17}-*.md for rationale. Namespaces are additive
// and must not be referenced by L1-L3 code paths until the L4 feature flag is on.
// =============================================================================

export const BIOMES = {
  /** Mix noise frequency. Lower = larger biome patches. 1/256 ≈ ~16-chunk islands — walkable in a session. */
  WEIGHT_NOISE_SCALE: 1 / 256,
  /** Width of the blend band in blocks. 12 = ~3/4-chunk fade; wide enough to feel soft, narrow enough to feel like a place. */
  TRANSITION_SOFTNESS_BLOCKS: 12,
  /** Trees per 16x16 forest chunk. 4 reads lush without hiding the sky. Tuned Day L4-2. */
  FOREST_TREES_PER_CHUNK: 4,
  /** Mountain surface-height multiplier over plains baseline. 2.4 clears US-L4-04's +20 m with headroom. */
  MOUNTAIN_HEIGHT_MULT: 2.4,
  /** Plains micro-roughness. 0.35 gives rolling hills without feeling ironed. */
  PLAINS_ROUGHNESS: 0.35,
  /** Snow cap begins at this y. Above the usual tree line; makes peaks pop in screencaps. */
  SNOW_CAP_Y: 72,
} as const;

export const LIGHTING = {
  /** Torches emit this level. 14 is genre-standard reach of ~14 blocks before full dark. */
  TORCH_LIGHT_LEVEL: 14,
  /** Direct sky = max. 15 so sky always wins a tie with a torch beneath open air. */
  SUNLIGHT_LEVEL_MAX: 15,
  /** Attenuation per block traversed in BFS. 1 = classic voxel falloff. */
  FALLOFF_PER_BLOCK: 1,
  /** Max cells popped from dirty queue per frame. 2000 keeps a cascade under 4 ms on mid hardware. */
  DIRTY_QUEUE_BUDGET_PER_FRAME: 2000,
  /** Floor on perceived torch brightness in shader (PRD §2.5 photosensitivity clamp). */
  TORCH_BRIGHTNESS_MIN: 0.4,
  /** Flicker peak-to-peak amplitude in brightness units. 0.06 reads alive, not seizure-inducing. */
  TORCH_FLICKER_AMPLITUDE: 0.06,
  /** Flicker base frequency in Hz. 5.5 + perlin feels like a real flame, not a strobe. Clamp ≤ 0.1 before shipping. */
  TORCH_FLICKER_HZ: 5.5,
} as const;

export const INVENTORY = {
  /** Backpack slots. 27 = genre-standard 3x9 grid. */
  BACKPACK_SLOTS: 27,
  /** Hotbar slots. Stays at 9 (L2) per PRD §8. */
  HOTBAR_SLOTS: 9,
  /** Max per-slot count. 64 is the voxel-sandbox convention and the number players reflexively expect. */
  MAX_STACK_SIZE: 64,
  /** Open/close panel animation. 140 ms = modern-snappy (iOS-ish), not sluggish. */
  OPEN_CLOSE_ANIM_MS: 140,
  /** Right-click split delay in ms. 0 = instant; feels responsive on drag-split. */
  SPLIT_HOLD_MS: 0,
  /** Separate IDB record key suffix for player state. Composes with PERSISTENCE.WORLD_ID (e.g. "world-0:player"). */
  PLAYER_STATE_KEY_SUFFIX: ":player",
  /** Schema version for player state. Bump on breaking shape change. */
  PLAYER_STATE_VERSION: 1,
} as const;

export const WATER = {
  /** Opacity. 0.55 reads watery without hiding what's under. Risk-#5 ceiling: ≤ 0.6. */
  OPACITY: 0.55,
  /** Tint. Slightly green-blue — lake, not pool. */
  TINT_RGB: [0.22, 0.55, 0.62] as const,
  /** Default sea level y. Plains biome fills depressions below this. */
  SEA_LEVEL_Y: 32,
  /** Shader wave amplitude in blocks. 0.03 = barely-there surface shimmer; sells "liquid" cheap. */
  WAVE_AMPLITUDE_BLOCKS: 0.03,
  /** Wave frequency Hz. 0.4 = slow lake-ripple, not storm. */
  WAVE_HZ: 0.4,
} as const;
