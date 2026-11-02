// Block registry. The ONE source of truth for block IDs.
// Any file that reads a block type imports BLOCKS from here — never hard-codes a number.
// L1: air + placeholder solid. L2 adds dirt/stone. L3 wires terrain gen.
// L4 adds wood/leaves/torch/water/sand/snow and lighting properties.

import { LIGHTING } from "../../design/config";

export const BLOCKS = {
  air:    0,
  grass:  1,
  dirt:   2,
  stone:  3,
  wood:   4,
  leaves: 5,
  torch:  6,
  water:  7,
  sand:   8,
  snow:   9,
} as const;

export type BlockId = typeof BLOCKS[keyof typeof BLOCKS];

/** Per-face UV index into the texture-array layer: top/bottom/N/S/E/W. */
export interface BlockFaceUVs {
  top: number; bottom: number; north: number; south: number; east: number; west: number;
}

/**
 * Minimal registry. Faces reference texture-array layers populated by
 * `src/render/textures.ts`. For L4 we re-use L2 layer indices for the new
 * blocks (dirt layer for wood/sand, grass-top for leaves/water, stone for
 * torch/snow) — a visual re-skin can land in a later day without touching
 * block ids. Palettes are swappable; ids are not.
 */
export const BLOCK_FACES: Record<Exclude<BlockId, 0>, BlockFaceUVs> = {
  [BLOCKS.grass]:  { top: 0, bottom: 2, north: 1, south: 1, east: 1, west: 1 },
  [BLOCKS.dirt]:   { top: 2, bottom: 2, north: 2, south: 2, east: 2, west: 2 },
  [BLOCKS.stone]:  { top: 3, bottom: 3, north: 3, south: 3, east: 3, west: 3 },
  // Re-use dirt layer for wood (brown bark feel) at L4; dedicated texture layer
  // can land in a later day without changing the id or ADR.
  [BLOCKS.wood]:   { top: 2, bottom: 2, north: 2, south: 2, east: 2, west: 2 },
  [BLOCKS.leaves]: { top: 0, bottom: 0, north: 0, south: 0, east: 0, west: 0 },
  [BLOCKS.torch]:  { top: 3, bottom: 3, north: 3, south: 3, east: 3, west: 3 },
  [BLOCKS.water]:  { top: 0, bottom: 0, north: 0, south: 0, east: 0, west: 0 },
  [BLOCKS.sand]:   { top: 2, bottom: 2, north: 2, south: 2, east: 2, west: 2 },
  [BLOCKS.snow]:   { top: 3, bottom: 3, north: 3, south: 3, east: 3, west: 3 },
};

/**
 * Collision solidity. The player's AABB clips against blocks for which this
 * returns true. Water and torches are cosmetic / interactive — the player
 * walks through them like air. Air itself is non-solid by definition.
 */
export function isSolid(id: BlockId): boolean {
  if (id === BLOCKS.air) return false;
  if (id === BLOCKS.water) return false;
  if (id === BLOCKS.torch) return false;
  return true;
}

/**
 * Light-transparency. Returns true if light propagates through this cell at
 * all. Air passes light freely; water and torches are transparent for render
 * and lighting; leaves pass light with extra attenuation (see
 * `lightAttenuation`). Opaque blocks (grass/dirt/stone/wood/sand/snow)
 * terminate propagation.
 */
export function isTransparent(id: BlockId): boolean {
  if (id === BLOCKS.air) return true;
  if (id === BLOCKS.water) return true;
  if (id === BLOCKS.torch) return true;
  if (id === BLOCKS.leaves) return true;
  return false;
}

/**
 * Light this block emits when placed. Only torches emit at L4; everything
 * else returns 0 so the propagator can skip them in the seed pass.
 */
export function emission(id: BlockId): number {
  if (id === BLOCKS.torch) return LIGHTING.TORCH_LIGHT_LEVEL;
  return 0;
}

/**
 * Per-block attenuation subtracted when light steps THROUGH this cell to a
 * neighbor. Air uses the LIGHTING.FALLOFF_PER_BLOCK default; leaves pay 2
 * blocks of extra falloff on top of that so a canopy dims an understory
 * without blacking it out.
 */
export function lightAttenuation(id: BlockId): number {
  if (id === BLOCKS.leaves) return LIGHTING.FALLOFF_PER_BLOCK + 2;
  return LIGHTING.FALLOFF_PER_BLOCK;
}
