// Backpack panel (US-L4-09..12): a 3x9 DOM overlay toggled with E. UI only, never inside the three.js scene.
//
// Integration (main.ts), in this order:
//   import { initHotbar } from "./ui/hotbar";
//   import { initBackpack, createInventoryDebugAPI } from "./ui/backpack";
//   initHotbar();
//   await initBackpack({ getPlayerExtras: () => ({ flying, position, yawPitch }) });   // loads + hydrates saved state
//   installDebugAPI({ ..., ...createInventoryDebugAPI() });                           // after the await, so __game implies hydrated
//
// Behaviour
//   E           toggles the panel (works with or without pointer lock; ignored with Ctrl/Cmd/Alt and on key repeat)
//   Esc         closes it. Closing cancels any drag in flight; nothing is lost because drags are atomic on drop.
//   open        releases pointer lock (document.exitPointerLock; PointerLockControls hears it via pointerlockchange)
//   close       does NOT re-lock: the player clicks back in (browsers also require a gesture, and Esc-exit has a cooldown)
//   lock engaged while open (something else called lock()) -> the panel closes, so a locked cursor never hides an open panel
//
// Keyboard: Tab reaches the toggle button, then the grid (one tab stop, roving tabindex). Arrow keys move through
// a 4-row grid (3 backpack rows, then the hotbar row), Home/End jump to row ends, Space/Enter picks up, then
// drops (Shift+Space picks up half). There is no focus trap; Tab leaves the panel.

import "./slots.css";
import "./backpack.css";
import { INVENTORY } from "../../design/config";
import type { PlayerState } from "../world/playerState";
import {
  BACKPACK_SIZE,
  HOTBAR_SIZE,
  addToInventory,
  flushInventory,
  getSlot,
  initInventory,
  onInventoryChange,
  setInventoryOpen,
  setSlot,
  snapshotPlayerState,
  type InitInventoryOptions,
  type SlotRef,
} from "./InventoryState";
import {
  cancelDrag,
  dropWithKeyboard,
  initDragDrop,
  isDragging,
  liftWithKeyboard,
  onInventoryDrag,
  slotElementOf,
  slotRefOf,
} from "./dragDrop";
import { blockName, createSlotButton, renderSlotButton } from "./slotView";

/** 3 rows of 9 (ADR-0015). Also the hotbar width, which keeps arrow-key columns aligned between the two. */
const COLS = 9;
const BACKPACK_ROWS = Math.ceil(BACKPACK_SIZE / COLS);
const HOTBAR_ROW = BACKPACK_ROWS;

export interface BackpackOptions extends InitInventoryOptions {
  root?: HTMLElement;
}

export interface BackpackHandle {
  readonly panel: HTMLElement;
  readonly toggleButton: HTMLButtonElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
}

/**
 * What main.ts spreads into window.__game. The first four are the agreed surface; flushInventory is an
 * addition so e2e tests can wait for the IndexedDB write instead of sleeping.
 */
export interface InventoryDebugAPI {
  openBackpack(): void;
  closeBackpack(): void;
  /** Deep copy of the current PlayerState (hotbar, backpack, selected slot, plus main.ts's extras). */
  getInventory(): PlayerState;
  /**
   * With a slot index: SET that slot to {blockId, count} (count clamped to the stack cap; count < 1 or air clears it).
   * Both indices null: pick-up semantics, i.e. stack into existing stacks then free slots, like collecting a block.
   * Throws RangeError for an index outside 0..8 (hotbar) / 0..26 (backpack).
   */
  simulateInventoryChange(hotbarSlot: number | null, backpackSlot: number | null, blockId: number, count: number): void;
  /** Resolves when every inventory change so far has been handed to IndexedDB. */
  flushInventory(): Promise<void>;
}

let handle: BackpackHandle | null = null;

const prefersReducedMotion = (): boolean => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

/** Neighbour in the 4-row logical grid (backpack rows, then the hotbar). Clamps at the edges: no wrapping. */
function neighbour(ref: SlotRef, code: string): SlotRef {
  let row = ref.lane === "hotbar" ? HOTBAR_ROW : Math.floor(ref.index / COLS);
  let col = ref.index % COLS;
  if (code === "ArrowLeft") col = Math.max(0, col - 1);
  else if (code === "ArrowRight") col = Math.min(COLS - 1, col + 1);
  else if (code === "ArrowUp") row = Math.max(0, row - 1);
  else if (code === "ArrowDown") row = Math.min(HOTBAR_ROW, row + 1);
  else if (code === "Home") col = 0;
  else if (code === "End") col = COLS - 1;
  return row === HOTBAR_ROW
    ? { lane: "hotbar", index: Math.min(col, HOTBAR_SIZE - 1) }
    : { lane: "backpack", index: row * COLS + col };
}

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

function slotName(ref: SlotRef): string {
  return `${ref.lane} slot ${ref.index + 1}`;
}

/** Builds the panel + toggle button and wires input. Idempotent. Does not load saved state: see initBackpack(). */
export function mountBackpack(root: HTMLElement = document.body): BackpackHandle {
  if (handle) return handle;

  // ---- markup
  const panel = document.createElement("section");
  panel.id = "backpack-panel";
  panel.dataset.panel = "backpack"; // US-L4-09 contract: [data-panel="backpack"].hidden
  panel.dataset.state = "closed";
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "backpack-title");
  panel.style.setProperty("--backpack-anim", `${INVENTORY.OPEN_CLOSE_ANIM_MS}ms`);
  panel.style.setProperty("--backpack-cols", String(COLS));

  const header = document.createElement("div");
  header.className = "header";
  const title = document.createElement("h2");
  title.id = "backpack-title";
  title.textContent = "Backpack";
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = "E or Esc to close";
  header.append(title, hint);

  const grid = document.createElement("div");
  grid.className = "grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Backpack slots");
  const slots = Array.from({ length: BACKPACK_SIZE }, (_, i) => {
    const slot = createSlotButton("backpack", i);
    slot.tabIndex = i === 0 ? 0 : -1; // roving tabindex: the grid is ONE tab stop
    grid.appendChild(slot);
    return slot;
  });

  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");

  panel.append(header, grid, live);

  const toggleButton = document.createElement("button");
  toggleButton.id = "backpack-toggle";
  toggleButton.type = "button";
  toggleButton.setAttribute("aria-label", "Backpack");
  toggleButton.setAttribute("aria-controls", panel.id);
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.setAttribute("aria-keyshortcuts", "E");
  toggleButton.style.setProperty("--hotbar-slots", String(HOTBAR_SIZE)); // positions it beside the hotbar
  const toggleText = document.createElement("span");
  toggleText.textContent = "Backpack";
  const toggleKey = document.createElement("kbd");
  toggleKey.textContent = "E";
  toggleKey.setAttribute("aria-hidden", "true");
  toggleButton.append(toggleText, toggleKey);

  root.append(toggleButton, panel);

  // ---- render
  const render = (): void => {
    slots.forEach((slot, i) => renderSlotButton(slot, "backpack", i, getSlot({ lane: "backpack", index: i })));
  };
  onInventoryChange(render);
  render();

  const announce = (msg: string): void => { live.textContent = msg; };
  onInventoryDrag((e) => {
    const name = blockName(e.blockId);
    if (e.type === "lift") announce(`Picked up ${e.count} ${name} from ${slotName(e.from)}`);
    else if (e.type === "cancel") announce(`Cancelled, ${name} stays in ${slotName(e.from)}`);
    else if (e.type === "reject") announce(`Cannot drop ${name} on ${slotName(e.to)}`);
    else if (e.result.kind === "swap") announce(`Swapped ${name} with the stack in ${slotName(e.to)}`);
    else announce(`Dropped ${e.result.moved} ${name} on ${slotName(e.to)}`);
  });

  // ---- open / close
  let opened = false;
  let closeTimer: number | undefined;
  let returnFocus: Element | null = null;
  let currentIndex = 0;

  const setCurrent = (i: number): void => {
    currentIndex = i;
    slots.forEach((s, k) => { s.tabIndex = k === i ? 0 : -1; });
  };
  const focusSlot = (ref: SlotRef): void => {
    if (ref.lane === "backpack") setCurrent(ref.index);
    slotElementOf(ref)?.focus({ preventScroll: true });
  };

  const finishClose = (): void => {
    panel.hidden = true;
    document.body.classList.remove("backpack-open");
  };

  const open = (): void => {
    if (opened) return;
    opened = true;
    window.clearTimeout(closeTimer);
    returnFocus = document.activeElement;
    setInventoryOpen(true);
    document.body.classList.add("backpack-open");
    panel.hidden = false;
    void panel.offsetWidth; // commit the closed pose so the transition runs from it
    panel.dataset.state = "open";
    toggleButton.setAttribute("aria-expanded", "true");
    // Release the cursor so the player can use it. PointerLockControls hears pointerlockchange and fires "unlock".
    if (document.pointerLockElement) document.exitPointerLock();
    focusSlot({ lane: "backpack", index: currentIndex });
  };

  const close = (): void => {
    if (!opened) return;
    opened = false;
    cancelDrag();
    setInventoryOpen(false);
    panel.dataset.state = "closed";
    toggleButton.setAttribute("aria-expanded", "false");
    // Do not leave focus on a control that is about to disappear.
    if (panel.contains(document.activeElement)) {
      const back = returnFocus;
      if (back instanceof HTMLElement && back !== document.body && back.isConnected && !panel.contains(back)) back.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement).blur();
    }
    returnFocus = null;
    // `hidden` flips after the exit transition so it can play. Reduced motion has no transition, so no wait.
    const ms = prefersReducedMotion() ? 0 : INVENTORY.OPEN_CLOSE_ANIM_MS;
    if (ms === 0) finishClose();
    else closeTimer = window.setTimeout(finishClose, ms);
  };

  const toggle = (): void => (opened ? close() : open());
  toggleButton.addEventListener("click", toggle);
  panel.addEventListener("focusin", (e) => {
    const ref = slotRefOf(e.target as Element | null);
    if (ref?.lane === "backpack") setCurrent(ref.index);
  });

  // ---- keyboard
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (e.code === "KeyE") {
      e.preventDefault();
      if (!e.repeat) toggle();
      return;
    }
    if (!opened) return;
    if (e.code === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const ref = slotRefOf(e.target as Element | null);
    if (!ref) {
      // Focus is on the panel itself or the toggle: an arrow key steps into the grid.
      if (NAV_KEYS.has(e.code) && e.target === panel) { e.preventDefault(); focusSlot({ lane: "backpack", index: currentIndex }); }
      return;
    }
    if (NAV_KEYS.has(e.code)) {
      e.preventDefault();
      const next = neighbour(ref, e.code);
      if (slotElementOf(next)) focusSlot(next);
    } else if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault(); // also stops the button's synthetic click (which would select a hotbar slot)
      if (e.repeat) return;
      if (isDragging()) dropWithKeyboard(ref);
      else liftWithKeyboard(ref, e.shiftKey);
    }
  });
  // Space activates a button on keyup; cancel that too or the hotbar would select the slot we just picked up.
  window.addEventListener("keyup", (e) => {
    if (opened && (e.code === "Space" || e.code === "Enter") && slotRefOf(e.target as Element | null)) e.preventDefault();
  });

  // ---- pointer lock + page lifecycle
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement && opened) close();
  });
  const flush = (): void => { void flushInventory(); };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  initDragDrop();

  handle = { panel, toggleButton, open, close, toggle, isOpen: () => opened };
  return handle;
}

/** Load saved state, hydrate the inventory, turn saving on, then mount the panel. See the header for the main.ts call. */
export async function initBackpack(opts: BackpackOptions = {}): Promise<BackpackHandle> {
  await initInventory(opts);
  return mountBackpack(opts.root);
}

/** Debug/e2e surface for window.__game (debug builds only). Mounts the panel on demand. */
export function createInventoryDebugAPI(): InventoryDebugAPI {
  return {
    openBackpack: () => mountBackpack().open(),
    closeBackpack: () => mountBackpack().close(),
    getInventory: () => snapshotPlayerState(),
    simulateInventoryChange: (hotbarSlot, backpackSlot, blockId, count) => {
      if (hotbarSlot === null && backpackSlot === null) {
        addToInventory(blockId, count);
        return;
      }
      if (hotbarSlot !== null) setSlot({ lane: "hotbar", index: hotbarSlot }, { blockId, count });
      if (backpackSlot !== null) setSlot({ lane: "backpack", index: backpackSlot }, { blockId, count });
    },
    flushInventory,
  };
}
