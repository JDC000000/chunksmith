// Slot DOM shared by the hotbar, the backpack panel and the drag ghost, so all three always look and read alike.
// Pure view code: it renders a stack into an element and never touches inventory state.

import { BLOCKS } from "../world/blocks";
import type { Lane, Slot } from "./InventoryState";

/** Name comes from the registry, so renaming a block never leaves a slot label stale. */
export function blockName(id: number): string {
  return Object.entries(BLOCKS).find(([, v]) => v === id)?.[0] ?? `block ${id}`;
}

/** Screen-reader name for a slot: position first, then what is in it. Never relies on the icon colour. */
export function slotLabel(lane: Lane, index: number, stack: Slot): string {
  const where = `${lane === "hotbar" ? "Hotbar" : "Backpack"} slot ${index + 1}`;
  return `${where}: ${stack ? `${stack.count} ${blockName(stack.blockId)}` : "empty"}`;
}

function span(className: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = className;
  return s;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** One slot button. `data-lane` + `data-index` are the contract dragDrop.ts and the tests rely on. */
export function createSlotButton(lane: Lane, index: number): HTMLButtonElement {
  const slot = document.createElement("button");
  slot.type = "button";
  slot.className = "slot";
  slot.dataset.lane = lane;
  slot.dataset.index = String(index);
  const count = span("count");
  count.hidden = true;
  slot.append(span("icon"), span("name"), count);
  return slot;
}

/** Writes `stack` into a slot button created by createSlotButton. Only touches the DOM where something changed. */
export function renderSlotButton(slot: HTMLElement, lane: Lane, index: number, stack: Slot): void {
  const icon = slot.querySelector<HTMLElement>(".icon")!;
  const name = slot.querySelector<HTMLElement>(".name")!;
  const count = slot.querySelector<HTMLElement>(".count")!;
  const block = stack ? blockName(stack.blockId) : "";

  slot.dataset.empty = stack ? "false" : "true";
  if (icon.dataset.block !== block) icon.dataset.block = block;
  setText(name, block);
  // A count of 1 is implied; showing "1" on every placed block is noise.
  const showCount = !!stack && stack.count > 1;
  count.hidden = !showCount;
  setText(count, showCount ? String(stack!.count) : "");
  const label = slotLabel(lane, index, stack);
  if (slot.getAttribute("aria-label") !== label) slot.setAttribute("aria-label", label);
}

/** The element that follows the pointer during a drag. aria-hidden: the live region announces drags instead. */
export function createGhost(blockId: number, count: number): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const icon = span("icon");
  icon.dataset.block = blockName(blockId);
  const badge = span("count");
  badge.hidden = count <= 1;
  badge.textContent = count > 1 ? String(count) : "";
  ghost.append(icon, badge);
  return ghost;
}
