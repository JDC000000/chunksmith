// Block registry. The ONE source of truth for block IDs.
// Any file that reads a block type imports BLOCKS from here — never hard-codes a number.
// L1: air + placeholder solid. L2 adds dirt/stone. L3+ adds biome blocks.

export const BLOCKS = {
  air:   0,
  grass: 1,
  dirt:  2,
  stone: 3,
} as const;

export type BlockId = typeof BLOCKS[keyof typeof BLOCKS];

/** Per-face UV index into the texture-array layer: top/bottom/N/S/E/W. */
export interface BlockFaceUVs {
  top: number; bottom: number; north: number; south: number; east: number; west: number;
}

/** Minimal registry for L1-L2. Faces reference texture-array layers (populated in L2). */
export const BLOCK_FACES: Record<Exclude<BlockId, 0>, BlockFaceUVs> = {
  [BLOCKS.grass]: { top: 0, bottom: 2, north: 1, south: 1, east: 1, west: 1 },
  [BLOCKS.dirt]:  { top: 2, bottom: 2, north: 2, south: 2, east: 2, west: 2 },
  [BLOCKS.stone]: { top: 3, bottom: 3, north: 3, south: 3, east: 3, west: 3 },
};

export function isSolid(id: BlockId): boolean { return id !== BLOCKS.air; }
