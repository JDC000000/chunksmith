// Hotbar DOM overlay (US-L2-04). UI only: it owns selection via HotbarState and never touches game state.
//
// Integration (Day 6 orchestrator will add to main.ts):
//   import { initHotbar } from "./ui/hotbar";
//   initHotbar();
// And expose getSelectedBlock on window.__game in gameAPI.ts.

import "./hotbar.css";
import { BLOCKS, type BlockId } from "../world/blocks";
import { HOTBAR_SLOTS, getSelectedIndex, onSelectionChange, selectIndex } from "./HotbarState";

/** Slot label comes from the registry, so renaming a block never leaves the hotbar stale. */
function blockName(id: BlockId): string {
  return Object.entries(BLOCKS).find(([, v]) => v === id)?.[0] ?? `block ${id}`;
}

/** Wrapping step through the slots; selectIndex() itself rejects out-of-range indices. */
function step(delta: 1 | -1): void {
  const n = HOTBAR_SLOTS.length;
  selectIndex((getSelectedIndex() + delta + n) % n);
}

/** Mounts the hotbar under `root` and wires input. Idempotent: a second call returns the existing element. */
export function initHotbar(root: HTMLElement = document.body): HTMLElement {
  const existing = root.querySelector<HTMLElement>("#hotbar");
  if (existing) return existing;

  const bar = document.createElement("div");
  bar.id = "hotbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Hotbar");

  const slots = HOTBAR_SLOTS.map((id, i) => {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "slot";
    slot.dataset.index = String(i);
    slot.textContent = blockName(id);
    slot.setAttribute("aria-keyshortcuts", String(i + 1));
    slot.addEventListener("click", () => selectIndex(i));
    bar.appendChild(slot);
    return slot;
  });

  const render = (selected: number): void => {
    slots.forEach((slot, i) => {
      slot.classList.toggle("selected", i === selected);
      slot.setAttribute("aria-pressed", String(i === selected));
    });
  };
  onSelectionChange(render);
  render(getSelectedIndex());

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl/Cmd+digit is the browser's tab switcher
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) selectIndex(Number(m[1]) - 1);
  });

  // Wheel down = next slot, up = previous, wrapping. Passive: we never block page scroll/zoom.
  window.addEventListener("wheel", (e) => {
    if (e.deltaY !== 0) step(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  root.appendChild(bar);
  return bar;
}
