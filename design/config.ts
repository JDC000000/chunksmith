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
