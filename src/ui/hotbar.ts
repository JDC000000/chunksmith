// Hotbar DOM overlay (US-L2-04, extended in L4 for US-L4-11). UI only: it renders the inventory's 9 hotbar
// slots and owns selection (via HotbarState); it never touches game state.
//
// Integration (main.ts):
//   import { initHotbar } from "./ui/hotbar";
//   initHotbar();
// The backpack panel (backpack.ts) is separate; the two share inventory state and the drag mechanics, so a
// stack can be dragged between them. While the backpack is closed the hotbar behaves exactly as in L2:
// click or Digit1..9 selects, wheel cycles, and nothing can be dragged.

import "./slots.css";
import "./hotbar.css";
import { HOTBAR_SIZE, getSlot, onInventoryChange } from "./InventoryState";
import { getSelectedIndex, selectIndex } from "./HotbarState";
import { initDragDrop } from "./dragDrop";
import { createSlotButton, renderSlotButton } from "./slotView";

/** Wrapping step through the slots; selectIndex() itself rejects out-of-range indices. */
function step(delta: 1 | -1): void {
  selectIndex((getSelectedIndex() + delta + HOTBAR_SIZE) % HOTBAR_SIZE);
}

/** Mounts the hotbar under `root` and wires input. Idempotent: a second call returns the existing element. */
export function initHotbar(root: HTMLElement = document.body): HTMLElement {
  const existing = root.querySelector<HTMLElement>("#hotbar");
  if (existing) return existing;

  const bar = document.createElement("div");
  bar.id = "hotbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Hotbar");

  const slots = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
    const slot = createSlotButton("hotbar", i);
    slot.setAttribute("aria-keyshortcuts", String(i + 1));
    slot.addEventListener("click", () => selectIndex(i));
    bar.appendChild(slot);
    return slot;
  });

  const render = (): void => {
    const selected = getSelectedIndex();
    slots.forEach((slot, i) => {
      renderSlotButton(slot, "hotbar", i, getSlot({ lane: "hotbar", index: i }));
      slot.classList.toggle("selected", i === selected);
      slot.setAttribute("aria-pressed", String(i === selected));
    });
  };
  onInventoryChange(render); // fires for slot contents (drag/drop, pick-up, hydrate) AND for selectIndex()
  render();

  // Drag source + drop target. The delegated listeners are shared with the backpack and only act while it is open.
  initDragDrop();

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
