// Hotbar selection API. Since L4 this is a thin facade over InventoryState (the hotbar's 9 slots are inventory
// slots now), kept so existing callers do not change: main.ts reads getSelectedBlock() on every place, and
// tests/e2e/hotbar.spec.ts imports getSelectedIndex()/getSelectedBlock() straight from this file.
//
// Behaviour change from L2/L3: the old fixed 3-entry HOTBAR_SLOTS array is gone. The first three slots still
// start as grass, dirt, stone (the starter kit), but there are 9 slots and any of them can be empty. An empty
// selected slot yields BLOCKS.air from getSelectedBlock(); the place handler must treat that as "nothing to place".

export {
  getSelectedIndex,
  getSelectedBlock,
  selectIndex,
  onSelectionChange,
  HOTBAR_SIZE,
} from "./InventoryState";
export type { SelectionListener } from "./InventoryState";
