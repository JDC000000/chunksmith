// Pointer-based drag and drop for inventory slots, shared by the hotbar and the backpack panel.
//
// Hand-rolled on purpose (ADR-0015 leaves the choice open): the HTML5 drag API cannot start a drag from a
// <button> reliably across browsers, gives no control over the ghost, and fires no events at all while the
// pointer is locked. Pointer events work with mouse, pen and touch from one code path.
//
// How it works: ONE delegated listener set on `document`, so any element carrying `.slot[data-lane][data-index]`
// is automatically a drag source and a drop target. Nothing here knows about the panel or hotbar markup.
//
//   left button   press a stack, move past DRAG_THRESHOLD_PX, release over another slot -> whole stack
//   right button  same, but lifts HALF the stack, rounded up (the source keeps the rest). SPLIT_HOLD_MS = 0 means
//                 the split is armed the instant the button goes down.
//   Esc / release outside any slot / lost pointer -> cancel
//
// Dragging is purely visual until the drop: no item leaves its slot while the ghost is in the air, and the
// drop itself is one atomic transfer() (see InventoryState.ts). Cancelling therefore needs no undo.
//
// Keyboard equivalent (PRD-L4 section 2.5): liftWithKeyboard() / dropWithKeyboard(), driven by backpack.ts.
// Drag is live only while the inventory is open; with the panel closed the hotbar slots just click-to-select.

import { INVENTORY } from "../../design/config";
import {
  getSlot,
  isInventoryOpen,
  sameRef,
  transfer,
  type SlotRef,
  type TransferResult,
} from "./InventoryState";
import { createGhost } from "./slotView";

/**
 * Pixels the pointer must travel before a press becomes a drag; below it the press is a plain click (so the
 * hotbar still selects on click). 4px absorbs hand jitter. This is a feel constant: it belongs in INVENTORY in
 * design/config.ts (game-designer owns that file), kept here until it is moved.
 */
export const DRAG_THRESHOLD_PX = 4;

export type InventoryDragEvent =
  | { type: "lift"; from: SlotRef; blockId: number; count: number }
  | { type: "drop"; from: SlotRef; to: SlotRef; blockId: number; count: number; result: TransferResult }
  | { type: "reject"; from: SlotRef; to: SlotRef; blockId: number; count: number }
  | { type: "cancel"; from: SlotRef; blockId: number; count: number };

interface Session {
  kind: "pointer" | "keyboard";
  from: SlotRef;
  blockId: number;
  /** Amount lifted: the whole stack, or ceil(half) for a right-button / Shift lift. */
  count: number;
  button: number;
  pointerId: number;
  startX: number;
  startY: number;
  pressedAt: number;
  /** Pointer only: threshold crossed, ghost showing. */
  active: boolean;
  ghost: HTMLElement | null;
}

let session: Session | null = null;
let hover: HTMLElement | null = null;
let suppressClick = false;
let installed = false;
const listeners = new Set<(e: InventoryDragEvent) => void>();

const SLOT_SELECTOR = ".slot[data-lane][data-index]";

/** Reads the slot a DOM node belongs to, or null if it is not inside a slot. */
export function slotRefOf(el: Element | null): SlotRef | null {
  const slot = el?.closest<HTMLElement>(SLOT_SELECTOR);
  if (!slot) return null;
  const lane = slot.dataset.lane;
  const index = Number(slot.dataset.index);
  if ((lane !== "hotbar" && lane !== "backpack") || !Number.isInteger(index)) return null;
  return { lane, index };
}

export function slotElementOf(ref: SlotRef): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.slot[data-lane="${ref.lane}"][data-index="${ref.index}"]`);
}

export function onInventoryDrag(l: (e: InventoryDragEvent) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit(e: InventoryDragEvent): void {
  for (const l of listeners) l(e);
}

export function isDragging(): boolean { return session !== null; }

/** What is currently lifted, for UI that wants to describe it. Null when idle. */
export function getLifted(): { from: SlotRef; blockId: number; count: number } | null {
  return session ? { from: session.from, blockId: session.blockId, count: session.count } : null;
}

function setHover(el: HTMLElement | null): void {
  if (hover === el) return;
  hover?.classList.remove("drop-target");
  hover = el;
  hover?.classList.add("drop-target");
}

function clearSession(): void {
  const s = session;
  session = null;
  setHover(null);
  if (!s) return;
  s.ghost?.remove();
  slotElementOf(s.from)?.classList.remove("is-lifted");
  document.body.classList.remove("inventory-dragging");
}

/** Abort whatever is in flight (pointer drag or keyboard carry). Safe to call when idle. */
export function cancelDrag(): void {
  const s = session;
  if (!s) return;
  const wasVisible = s.kind === "keyboard" || s.active;
  clearSession();
  if (wasVisible) emit({ type: "cancel", from: s.from, blockId: s.blockId, count: s.count });
}

function liftAmount(stackCount: number, half: boolean): number {
  return half ? Math.ceil(stackCount / 2) : stackCount;
}

function moveGhost(s: Session, x: number, y: number): void {
  s.ghost?.style.setProperty("--x", `${x}px`);
  s.ghost?.style.setProperty("--y", `${y}px`);
}

function slotAt(x: number, y: number): HTMLElement | null {
  // The ghost is pointer-events:none, so elementFromPoint sees straight through it to the slot beneath.
  return document.elementFromPoint(x, y)?.closest<HTMLElement>(SLOT_SELECTOR) ?? null;
}

function activate(s: Session): void {
  s.active = true;
  s.ghost = createGhost(s.blockId, s.count);
  document.body.appendChild(s.ghost);
  slotElementOf(s.from)?.classList.add("is-lifted");
  document.body.classList.add("inventory-dragging");
  emit({ type: "lift", from: s.from, blockId: s.blockId, count: s.count });
}

/* ---- pointer ---------------------------------------------------------------------------------- */

function onPointerDown(e: PointerEvent): void {
  if (!isInventoryOpen() || session) return;
  if (e.button !== 0 && e.button !== 2) return;
  const from = slotRefOf(e.target as Element | null);
  if (!from) return;
  const stack = getSlot(from);
  if (!stack) return;
  suppressClick = false;
  session = {
    kind: "pointer",
    from,
    blockId: stack.blockId,
    count: liftAmount(stack.count, e.button === 2),
    button: e.button,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    pressedAt: performance.now(),
    active: false,
    ghost: null,
  };
}

function onPointerMove(e: PointerEvent): void {
  const s = session;
  if (!s || s.kind !== "pointer" || e.pointerId !== s.pointerId) return;
  // A pointerup we never saw (released outside the window, alt-tab): do not leave a ghost stuck to the cursor.
  if (e.buttons === 0) { cancelDrag(); return; }
  if (!s.active) {
    if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD_PX) return;
    // Split-hold gate. Config says 0 (instant), so this never delays today; it keeps the knob honest if tuned up.
    if (s.button === 2 && performance.now() - s.pressedAt < INVENTORY.SPLIT_HOLD_MS) return;
    activate(s);
  }
  moveGhost(s, e.clientX, e.clientY);
  const over = slotAt(e.clientX, e.clientY);
  setHover(over && !sameRef(slotRefOf(over)!, s.from) ? over : null);
}

function onPointerUp(e: PointerEvent): void {
  const s = session;
  if (!s || s.kind !== "pointer" || e.pointerId !== s.pointerId) return;
  if (!s.active) { clearSession(); return; } // a click, not a drag: let it through untouched

  const to = slotRefOf(slotAt(e.clientX, e.clientY));
  // The click that follows a drag must not select the hotbar slot it happened to end on.
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  clearSession();

  if (!to || sameRef(to, s.from)) {
    emit({ type: "cancel", from: s.from, blockId: s.blockId, count: s.count });
    return;
  }
  const result = transfer(s.from, to, s.count);
  if (result.kind === "none") emit({ type: "reject", from: s.from, to, blockId: s.blockId, count: s.count });
  else emit({ type: "drop", from: s.from, to, blockId: s.blockId, count: s.count, result });
}

/* ---- keyboard --------------------------------------------------------------------------------- */

/** Pick up the stack in `from` (all of it, or half rounded up). False if idle-state or the slot is empty. */
export function liftWithKeyboard(from: SlotRef, half = false): boolean {
  if (!isInventoryOpen() || session) return false;
  const stack = getSlot(from);
  if (!stack) return false;
  session = {
    kind: "keyboard",
    from,
    blockId: stack.blockId,
    count: liftAmount(stack.count, half),
    button: -1,
    pointerId: -1,
    startX: 0,
    startY: 0,
    pressedAt: 0,
    active: true,
    ghost: null,
  };
  slotElementOf(from)?.classList.add("is-lifted");
  emit({ type: "lift", from, blockId: stack.blockId, count: session.count });
  return true;
}

/**
 * Put the carried stack down on `to`. Dropping on the source cancels the carry. A rejected drop (target full,
 * or a partial stack onto a different block) keeps carrying so the player can try another slot.
 * Returns null when nothing is being carried.
 */
export function dropWithKeyboard(to: SlotRef): TransferResult | null {
  const s = session;
  if (!s || s.kind !== "keyboard") return null;
  if (sameRef(to, s.from)) { cancelDrag(); return { kind: "none", moved: 0 }; }
  const result = transfer(s.from, to, s.count);
  if (result.kind === "none") {
    emit({ type: "reject", from: s.from, to, blockId: s.blockId, count: s.count });
    return result;
  }
  clearSession();
  emit({ type: "drop", from: s.from, to, blockId: s.blockId, count: s.count, result });
  return result;
}

/** While carrying by keyboard, highlight the slot focus is on, exactly like the pointer hover highlight. */
function onFocusIn(e: FocusEvent): void {
  const s = session;
  if (!s || s.kind !== "keyboard") return;
  const ref = slotRefOf(e.target as Element | null);
  setHover(ref && !sameRef(ref, s.from) ? slotElementOf(ref) : null);
}

/* ---- install ---------------------------------------------------------------------------------- */

/** Installs the shared listeners once. Idempotent: hotbar.ts and backpack.ts both call it. */
export function initDragDrop(): void {
  if (installed) return;
  installed = true;

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", () => cancelDrag());
  document.addEventListener("focusin", onFocusIn);
  window.addEventListener("blur", () => cancelDrag());

  // Capture phase so we run before the hotbar's own click-to-select handler.
  document.addEventListener("click", (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  // Right button is the split gesture while the inventory is open; the browser menu would eat it.
  document.addEventListener("contextmenu", (e) => {
    if (!isInventoryOpen()) return;
    if ((e.target as Element | null)?.closest?.(`${SLOT_SELECTOR}, [data-panel="backpack"]`)) e.preventDefault();
  }, true);
}
