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
  VERTICAL_RADIUS_CHUNKS: 4,
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
  AMBIENT_FLOOR: 0.35,
  AMBIENT_RANGE: 0.25,
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
  SPAWN_FLYING: true,
};
