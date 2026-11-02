// Player-scoped IDB persistence (hotbar + backpack + position/orientation).
//
// ADR-0015: a separate IDB record keyed by `<WORLD_ID><INVENTORY.PLAYER_STATE_KEY_SUFFIX>`.
// Writes a plain JS object (idb-keyval structured-clones), so DevTools shows
// the shape without a parser. The ui-dev subagent imports the exact types
// below — do not rename.
//
// No three.js. Compiles for Workers (L5+ parity).

import { del, get, set } from "idb-keyval";
import { INVENTORY, PHYSICS } from "../../design/config";

/**
 * One stacked item in a slot. `count` must be in [1, INVENTORY.MAX_STACK_SIZE].
 * Empty slots are represented as `null` in the hotbar / backpack arrays.
 */
export interface InventoryStack {
  blockId: number;
  count: number;
}

/**
 * Player-scoped persisted state. The shape is pinned by ADR-0015 and
 * exported for `src/ui/` to import — any field change here is a schema bump
 * (increment INVENTORY.PLAYER_STATE_VERSION in design/config.ts).
 */
export interface PlayerState {
  /** Schema version, matched against INVENTORY.PLAYER_STATE_VERSION on load. */
  version: number;
  /** Length INVENTORY.HOTBAR_SLOTS (9). */
  hotbar: Array<InventoryStack | null>;
  /** Length INVENTORY.BACKPACK_SLOTS (27). */
  backpack: Array<InventoryStack | null>;
  /** 0..HOTBAR_SLOTS-1. */
  selectedHotbarSlot: number;
  /** Flight mode. New-player default comes from PHYSICS.SPAWN_FLYING. */
  flying: boolean;
  /** World-space position. */
  position: { x: number; y: number; z: number };
  /** Camera orientation. */
  yawPitch: { yaw: number; pitch: number };
}

/** Compose the IDB key for a given worldId. See ADR-0015. */
export function playerStateKey(worldId: string): string {
  return `${worldId}${INVENTORY.PLAYER_STATE_KEY_SUFFIX}`;
}

/**
 * Build a brand-new PlayerState for a never-played world. UI calls this when
 * `loadPlayerState` returns `undefined`. Flight follows PHYSICS.SPAWN_FLYING
 * so a new player doesn't fall through the terrain on first paint.
 */
export function defaultPlayerState(): PlayerState {
  return {
    version: INVENTORY.PLAYER_STATE_VERSION,
    hotbar: Array(INVENTORY.HOTBAR_SLOTS).fill(null),
    backpack: Array(INVENTORY.BACKPACK_SLOTS).fill(null),
    selectedHotbarSlot: 0,
    flying: PHYSICS.SPAWN_FLYING,
    position: { x: 0, y: 0, z: 0 },
    yawPitch: { yaw: 0, pitch: 0 },
  };
}

/**
 * Load the player state for a world. Returns `undefined` if nothing is
 * stored OR if the stored record was written under a different schema
 * version — callers fall through to `defaultPlayerState()`.
 */
export async function loadPlayerState(
  worldId: string,
): Promise<PlayerState | undefined> {
  const raw = (await get(playerStateKey(worldId))) as PlayerState | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  if (raw.version !== INVENTORY.PLAYER_STATE_VERSION) return undefined;
  return raw;
}

/**
 * Persist the player state. Caller debounces (ChunkPersistence idle loop +
 * `beforeunload`). The write is small (JSON ~1 KB) — IDB cost is negligible.
 */
export async function savePlayerState(
  worldId: string,
  state: PlayerState,
): Promise<void> {
  await set(playerStateKey(worldId), state);
}

/** Nuke the player state for a world. Independent from chunk-delta `clearWorld`. */
export async function clearPlayerState(worldId: string): Promise<void> {
  await del(playerStateKey(worldId));
}
