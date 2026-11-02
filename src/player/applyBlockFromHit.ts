// Converts a raycast hit into the single mutation intent that World.applyBlockChange
// will accept. The player code NEVER mutates the world directly — this helper is the
// only bridge from "I clicked a block" to "here is a BlockChangeIntent".

import type { BlockChangeIntent, PlayerId } from "../world/types";
import type { BlockId } from "../world/blocks";
import type { RaycastHit } from "./raycast";

/**
 * Build a BlockChangeIntent from a raycast hit.
 * - break: target the hit cell itself.
 * - place: target the cell adjacent to the hit face (hit.cell + hit.normal), i.e.
 *   the empty cell on the outside of the face the ray crossed.
 *
 * `blockId` is ignored for break (World.applyBlockChange clears to air regardless),
 * but is kept in the intent for L5 netcode symmetry — the server echoes it back.
 */
export function hitToIntent(
  hit: RaycastHit,
  reason: "place" | "break",
  blockId: BlockId,
  playerId: PlayerId,
): BlockChangeIntent {
  const pos =
    reason === "break"
      ? { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z }
      : {
          x: hit.cell.x + hit.normal.x,
          y: hit.cell.y + hit.normal.y,
          z: hit.cell.z + hit.normal.z,
        };
  return { playerId, pos, blockId, reason, timestamp: Date.now() };
}
