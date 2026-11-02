// Hotbar selection state. Module-level on purpose: one hotbar per game keeps the surface tiny.
// The DOM overlay (hotbar.ts) writes it; Day 5 place/break reads getSelectedBlock().

import { BLOCKS, type BlockId } from "../world/blocks";

export const HOTBAR_SLOTS: readonly BlockId[] = [BLOCKS.grass, BLOCKS.dirt, BLOCKS.stone];
export type SelectionListener = (idx: number, blockId: BlockId) => void;

let selectedIndex = 0;
const listeners = new Set<SelectionListener>();

export function getSelectedIndex(): number { return selectedIndex; }
export function getSelectedBlock(): BlockId { return HOTBAR_SLOTS[selectedIndex]!; }
export function selectIndex(i: number): void {
  if (i < 0 || i >= HOTBAR_SLOTS.length) return;
  selectedIndex = i;
  for (const l of listeners) l(i, HOTBAR_SLOTS[i]!);
}
export function onSelectionChange(l: SelectionListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
