// Inventory state: the single source of truth for the 9 hotbar + 27 backpack slots (ADR-0015).
//
// Module-level on purpose (same call as the L2 HotbarState): one inventory per game keeps the surface tiny.
// This is UI-adjacent state, not world state, so the UI is allowed to mutate it. The world itself is still
// only ever mutated through World.applyBlockChange.
//
// Every mutation is ATOMIC: transfer() moves items in one step, so the state is consistent at every
// instant (a drag in flight is purely visual and never leaves items "in the air"). That is what makes it safe
// to call savePlayerState() after any change and to cancel a drag with no bookkeeping.
//
// Persistence is write-behind with at most one save in flight (+1 queued, coalesced). It stays OFF until
// initInventory()/configureInventoryPersistence() runs, so nothing is written before the saved state has been
// loaded and hydrated (that would clobber the player's real inventory with defaults).

import { BLOCKS, type BlockId } from "../world/blocks";
import { INVENTORY, PERSISTENCE } from "../../design/config";
import {
  type PlayerState,
  type InventoryStack,
  loadPlayerState,
  savePlayerState,
  defaultPlayerState,
} from "../world/playerState";

export type Lane = "hotbar" | "backpack";
export interface SlotRef { readonly lane: Lane; readonly index: number }
/** Slots hold immutable stacks: every mutation replaces the object, so references taken earlier never change. */
export type StackView = Readonly<InventoryStack>;
export type Slot = StackView | null;
/** The non-inventory part of PlayerState. main.ts owns it; the UI only ever reads it (at save time). */
export type PlayerExtras = Pick<PlayerState, "flying" | "position" | "yawPitch">;

export const HOTBAR_SIZE: number = INVENTORY.HOTBAR_SLOTS;
export const BACKPACK_SIZE: number = INVENTORY.BACKPACK_SLOTS;
export const MAX_STACK: number = INVENTORY.MAX_STACK_SIZE;

/** First-run kit. These three slots are the L2 hotbar (Digit1..3 = grass, dirt, stone), so L2/L3 behaviour is unchanged. */
const STARTER_KIT: ReadonlyArray<readonly [BlockId, number]> = [
  [BLOCKS.grass, MAX_STACK],
  [BLOCKS.dirt, MAX_STACK],
  [BLOCKS.stone, MAX_STACK],
];

export type SelectionListener = (idx: number, blockId: BlockId) => void;
export type TransferKind = "none" | "move" | "merge" | "swap";
export interface TransferResult {
  kind: TransferKind;
  /** Items that left the source slot (the whole lifted stack for a swap). */
  moved: number;
}

const lanes: Record<Lane, Slot[]> = {
  hotbar: new Array<Slot>(HOTBAR_SIZE).fill(null),
  backpack: new Array<Slot>(BACKPACK_SIZE).fill(null),
};
let selectedIndex = 0;
let open = false;
let extrasBase: PlayerExtras | null = null;

const changeListeners = new Set<() => void>();
const selectionListeners = new Set<SelectionListener>();
const openListeners = new Set<(open: boolean) => void>();

/** Every slot in "fill order": hotbar first, then backpack. addToInventory() walks this. */
const FILL_ORDER: readonly SlotRef[] = [
  ...Array.from({ length: HOTBAR_SIZE }, (_, index): SlotRef => ({ lane: "hotbar", index })),
  ...Array.from({ length: BACKPACK_SIZE }, (_, index): SlotRef => ({ lane: "backpack", index })),
];

function applyStarterKit(): void {
  lanes.hotbar.fill(null);
  lanes.backpack.fill(null);
  STARTER_KIT.forEach(([blockId, count], i) => { lanes.hotbar[i] = { blockId, count }; });
}
applyStarterKit();

/* ---- reads ---------------------------------------------------------------------------------- */

export function isValidRef(ref: SlotRef): boolean {
  const arr = lanes[ref.lane];
  return !!arr && Number.isInteger(ref.index) && ref.index >= 0 && ref.index < arr.length;
}

function assertRef(ref: SlotRef): void {
  if (!isValidRef(ref)) throw new RangeError(`inventory: no such slot ${ref.lane}[${ref.index}]`);
}

export function getSlot(ref: SlotRef): Slot {
  return isValidRef(ref) ? lanes[ref.lane][ref.index]! : null;
}

export function sameRef(a: SlotRef, b: SlotRef): boolean {
  return a.lane === b.lane && a.index === b.index;
}

/** Total items of one block across every slot. Drag/drop must never change this. */
export function countOf(blockId: number): number {
  let total = 0;
  for (const ref of FILL_ORDER) {
    const s = lanes[ref.lane][ref.index]!;
    if (s && s.blockId === blockId) total += s.count;
  }
  return total;
}

const cloneSlot = (s: Slot): InventoryStack | null => (s ? { blockId: s.blockId, count: s.count } : null);

/** A real item: integer id above air. Unknown ids are kept (a newer build may have saved them). */
const isItemId = (id: number): boolean => Number.isInteger(id) && id > BLOCKS.air;

/* ---- subscriptions -------------------------------------------------------------------------- */

/** Fires after ANY change to slots, selection or hydration. Cheap listeners only: they run on every mutation. */
export function onInventoryChange(l: () => void): () => void {
  changeListeners.add(l);
  return () => changeListeners.delete(l);
}

export function onSelectionChange(l: SelectionListener): () => void {
  selectionListeners.add(l);
  return () => selectionListeners.delete(l);
}

export function onInventoryOpenChange(l: (open: boolean) => void): () => void {
  openListeners.add(l);
  return () => openListeners.delete(l);
}

function emit(): void {
  for (const l of changeListeners) l();
}

function commit(): void {
  emit();
  persist();
}

/* ---- open/closed (shared so the hotbar knows when drag is live) ------------------------------ */

export function isInventoryOpen(): boolean { return open; }

export function setInventoryOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of openListeners) l(next);
}

/* ---- hotbar selection ----------------------------------------------------------------------- */

export function getSelectedIndex(): number { return selectedIndex; }

/** Block under the selected slot. An empty slot yields BLOCKS.air: callers that place blocks must treat air as "nothing to place". */
export function getSelectedBlock(): BlockId {
  return (lanes.hotbar[selectedIndex]?.blockId ?? BLOCKS.air) as BlockId;
}

export function selectIndex(i: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= HOTBAR_SIZE) return;
  selectedIndex = i;
  const block = getSelectedBlock();
  for (const l of selectionListeners) l(i, block);
  commit();
}

/* ---- mutations ------------------------------------------------------------------------------ */

/**
 * Overwrite one slot. Count is clamped to MAX_STACK; a non-item id or a count below 1 clears the slot.
 * This is a "set", not an "add": use addToInventory() for pick-up semantics.
 */
export function setSlot(ref: SlotRef, stack: Slot): void {
  assertRef(ref);
  let next: Slot = null;
  if (stack && isItemId(stack.blockId) && Number.isFinite(stack.count) && Math.floor(stack.count) >= 1) {
    next = { blockId: stack.blockId, count: Math.min(Math.floor(stack.count), MAX_STACK) };
  }
  lanes[ref.lane][ref.index] = next;
  commit();
}

/**
 * Move `count` items (default: the whole stack) from one slot to another.
 *   empty target          -> move
 *   same block            -> merge, capped at MAX_STACK; whatever does not fit STAYS in the source
 *   different block       -> swap, but only for a whole-stack lift (a partial lift cannot swap)
 * Totals per block are conserved in every branch.
 */
export function transfer(from: SlotRef, to: SlotRef, count?: number): TransferResult {
  const none: TransferResult = { kind: "none", moved: 0 };
  if (!isValidRef(from) || !isValidRef(to) || sameRef(from, to)) return none;
  const src = lanes[from.lane][from.index]!;
  if (!src) return none;

  const want = count === undefined ? src.count : Math.floor(count);
  const n = Math.min(want, src.count);
  if (!(n >= 1)) return none;

  const dst = lanes[to.lane][to.index]!;
  const remainder = (taken: number): Slot => (src.count - taken > 0 ? { blockId: src.blockId, count: src.count - taken } : null);

  if (!dst) {
    lanes[to.lane][to.index] = { blockId: src.blockId, count: n };
    lanes[from.lane][from.index] = remainder(n);
    commit();
    return { kind: "move", moved: n };
  }

  if (dst.blockId === src.blockId) {
    const moved = Math.min(n, MAX_STACK - dst.count);
    if (moved < 1) return none; // target already full
    lanes[to.lane][to.index] = { blockId: dst.blockId, count: dst.count + moved };
    lanes[from.lane][from.index] = remainder(moved);
    commit();
    return { kind: "merge", moved };
  }

  if (n < src.count) return none; // partial lift onto a different block: nothing sensible to swap
  lanes[to.lane][to.index] = { blockId: src.blockId, count: src.count };
  lanes[from.lane][from.index] = { blockId: dst.blockId, count: dst.count };
  commit();
  return { kind: "swap", moved: n };
}

/**
 * Pick-up semantics (US-L4-10): top up existing stacks of the block first (hotbar, then backpack), then fill
 * empty slots in the same order, never exceeding MAX_STACK. Returns the LEFTOVER that did not fit
 * (0 = everything stored); the caller decides what to do with it.
 */
export function addToInventory(blockId: number, count: number): number {
  let remaining = Number.isFinite(count) ? Math.floor(count) : 0;
  if (remaining < 1) return 0;
  if (!isItemId(blockId)) return remaining;

  let changed = false;
  for (const ref of FILL_ORDER) {
    if (remaining < 1) break;
    const s = lanes[ref.lane][ref.index]!;
    if (!s || s.blockId !== blockId || s.count >= MAX_STACK) continue;
    const add = Math.min(MAX_STACK - s.count, remaining);
    lanes[ref.lane][ref.index] = { blockId, count: s.count + add };
    remaining -= add;
    changed = true;
  }
  for (const ref of FILL_ORDER) {
    if (remaining < 1) break;
    if (lanes[ref.lane][ref.index]) continue;
    const add = Math.min(MAX_STACK, remaining);
    lanes[ref.lane][ref.index] = { blockId, count: add };
    remaining -= add;
    changed = true;
  }
  if (changed) commit();
  return remaining;
}

/* ---- PlayerState bridge --------------------------------------------------------------------- */

function pickExtras(s: PlayerState): PlayerExtras {
  return {
    flying: s.flying,
    position: { x: s.position.x, y: s.position.y, z: s.position.z },
    yawPitch: { yaw: s.yawPitch.yaw, pitch: s.yawPitch.pitch },
  };
}

function sanitizeStack(raw: InventoryStack | null | undefined): Slot {
  if (!raw || !isItemId(raw.blockId) || !Number.isFinite(raw.count) || Math.floor(raw.count) < 1) return null;
  return { blockId: raw.blockId, count: Math.min(Math.floor(raw.count), MAX_STACK) };
}

function sanitizeLane(raw: ReadonlyArray<InventoryStack | null> | undefined, size: number): Slot[] {
  return Array.from({ length: size }, (_, i) => sanitizeStack(raw?.[i]));
}

/**
 * Replace the whole inventory from a (possibly foreign) PlayerState: short/long arrays are padded/truncated,
 * bad stacks become empty, counts are clamped. A state with NO items at all is a brand-new player and gets the
 * starter kit, so a fresh game keeps the L2 hotbar. Does not persist (the state just came from storage).
 */
export function hydrateInventory(state: PlayerState): void {
  lanes.hotbar = sanitizeLane(state.hotbar, HOTBAR_SIZE);
  lanes.backpack = sanitizeLane(state.backpack, BACKPACK_SIZE);
  if (![...lanes.hotbar, ...lanes.backpack].some(Boolean)) applyStarterKit();
  selectedIndex = Number.isInteger(state.selectedHotbarSlot) && state.selectedHotbarSlot >= 0 && state.selectedHotbarSlot < HOTBAR_SIZE
    ? state.selectedHotbarSlot
    : 0;
  extrasBase = pickExtras(state);
  const block = getSelectedBlock();
  for (const l of selectionListeners) l(selectedIndex, block);
  emit();
}

/** Full PlayerState for saving/debug. `extras` defaults to the provider main.ts registered, else the last hydrated values. */
export function snapshotPlayerState(extras?: PlayerExtras): PlayerState {
  const e = extras ?? persistence?.getPlayerExtras?.() ?? (extrasBase ??= pickExtras(defaultPlayerState()));
  return {
    version: INVENTORY.PLAYER_STATE_VERSION,
    hotbar: lanes.hotbar.map(cloneSlot),
    backpack: lanes.backpack.map(cloneSlot),
    selectedHotbarSlot: selectedIndex,
    flying: e.flying,
    position: { x: e.position.x, y: e.position.y, z: e.position.z },
    yawPitch: { yaw: e.yawPitch.yaw, pitch: e.yawPitch.pitch },
  };
}

/* ---- persistence (write-behind, at most one save in flight) ---------------------------------- */

export interface InventoryPersistence {
  worldId: string;
  /**
   * Position / flight / look direction live in main.ts. Supply them here so an inventory save never writes
   * stale values over them. Read-only from the UI's side.
   */
  getPlayerExtras?: () => PlayerExtras;
}

let persistence: InventoryPersistence | null = null;
let inFlight: Promise<void> | null = null;
let savePending = false;
let warned = false;

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn("[chunksmith] inventory save failed (inventory stays in memory):", err);
}

/** Turn saving on (or off with null). Do this only AFTER the saved state has been hydrated. */
export function configureInventoryPersistence(cfg: InventoryPersistence | null): void {
  persistence = cfg;
}

function persist(): void {
  if (!persistence) return;
  if (inFlight) { savePending = true; return; }
  const worldId = persistence.worldId;
  inFlight = (async () => {
    try {
      do {
        savePending = false;
        // savePlayerState is called synchronously on the first pass, i.e. inside the mutation that caused it.
        await savePlayerState(worldId, snapshotPlayerState());
      } while (savePending);
    } catch (err) {
      warnOnce(err);
    } finally {
      inFlight = null;
    }
  })();
}

/** Resolves once every change made so far has been handed to storage. Used on page hide and by e2e tests. */
export function flushInventory(): Promise<void> {
  return inFlight ?? Promise.resolve();
}

export interface InitInventoryOptions {
  worldId?: string;
  /** Pass the state main.ts already loaded, to avoid a second read. Omit to load it here. */
  initialState?: PlayerState;
  getPlayerExtras?: () => PlayerExtras;
}

/** Load (or accept) the saved PlayerState, hydrate the inventory from it, then switch saving on. */
export async function initInventory(opts: InitInventoryOptions = {}): Promise<void> {
  const worldId = opts.worldId ?? PERSISTENCE.WORLD_ID;
  let state = opts.initialState;
  if (!state) {
    try {
      state = (await loadPlayerState(worldId)) ?? undefined;
    } catch (err) {
      warnOnce(err);
    }
  }
  hydrateInventory(state ?? defaultPlayerState());
  configureInventoryPersistence({ worldId, getPlayerExtras: opts.getPlayerExtras });
}
