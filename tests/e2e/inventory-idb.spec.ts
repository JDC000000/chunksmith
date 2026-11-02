import { test, expect, type Page } from "@playwright/test";
import { BLOCKS } from "../../src/world/blocks";
import { INVENTORY, PERSISTENCE } from "../../design/config";

/**
 * US-L4-12 (e2e side): the inventory survives a page reload. The unit side (save/load round-trip, version
 * mismatch, clearWorld) is tests/unit/playerState.test.ts.
 *
 * Each Playwright test gets a fresh browser context, hence a fresh IndexedDB, so every test starts from a
 * brand-new player. "Reload" is a real page.reload(): the second boot loads what the first one saved.
 *
 * Waiting: saves are write-behind, so before reloading we await window.__game.flushInventory() (resolves once the
 * IndexedDB write has been handed over) instead of sleeping.
 *
 * Mounting: same arrangement as inventory.spec.ts. main.ts is expected to wire the inventory UI; until it does,
 * prepare() mounts it itself on every load. The annotation records which path ran.
 */

const PANEL = '[data-panel="backpack"]';
const MAX = INVENTORY.MAX_STACK_SIZE;
const PLAYER_KEY = `${PERSISTENCE.WORLD_ID}${INVENTORY.PLAYER_STATE_KEY_SUFFIX}`; // ADR-0015: "world-0:player"

type Stack = { blockId: number; count: number } | null;
interface Inv { hotbar: Stack[]; backpack: Stack[]; selectedHotbarSlot: number }

const bp = (page: Page, i: number) => page.locator(`${PANEL} .slot[data-index="${i}"]`);
const hb = (page: Page, i: number) => page.locator(`#hotbar .slot[data-index="${i}"]`);

async function prepare(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__game !== undefined, undefined, { timeout: 5000 });
  const mountedBy = await page.evaluate(async () => {
    const g = (window as any).__game;
    if (typeof g.openBackpack === "function" && document.querySelector('[data-panel="backpack"]')) return "main.ts";
    const hotbarPath = "/src/ui/hotbar.ts"; // variable paths: resolved by the browser/Vite, not by tsc
    const backpackPath = "/src/ui/backpack.ts";
    if (!document.querySelector("#hotbar")) (await import(/* @vite-ignore */ hotbarPath)).initHotbar();
    const bpMod = await import(/* @vite-ignore */ backpackPath);
    await bpMod.initBackpack();
    Object.assign(g, bpMod.createInventoryDebugAPI());
    return "inventory-idb.spec.ts (main.ts integration pending)";
  });
  test.info().annotations.push({ type: "inventory mounted by", description: mountedBy });
}

async function boot(page: Page): Promise<void> {
  await page.goto("/?radius=1,1", { waitUntil: "networkidle" });
  await prepare(page);
}

/** Wait for the write to land, then reload for real and re-prepare. */
async function reload(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__game.flushInventory());
  await page.reload({ waitUntil: "networkidle" });
  await prepare(page);
}

const inv = (page: Page): Promise<Inv> => page.evaluate(() => (window as any).__game.getInventory());

async function clearAll(page: Page): Promise<void> {
  await page.evaluate(({ h, b }) => {
    const g = (window as any).__game;
    for (let i = 0; i < h; i++) g.simulateInventoryChange(i, null, 0, 0);
    for (let i = 0; i < b; i++) g.simulateInventoryChange(null, i, 0, 0);
  }, { h: INVENTORY.HOTBAR_SLOTS, b: INVENTORY.BACKPACK_SLOTS });
}

const openPanel = async (page: Page) => {
  await page.evaluate(() => (window as any).__game.openBackpack());
  await expect(page.locator(PANEL)).toBeVisible();
};

test.describe("US-L4-12 inventory persists across reload", () => {
  test("32 stone in backpack slot 0 is still there after close, reload, reopen", async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await page.evaluate((id) => (window as any).__game.simulateInventoryChange(null, 0, id, 32), BLOCKS.stone);
    await expect(bp(page, 0).locator(".count")).toHaveText("32");

    await page.keyboard.press("Escape"); // close
    await expect(page.locator(PANEL)).toBeHidden();

    await reload(page);
    await expect(page.locator(PANEL)).toBeHidden(); // the panel itself is not persisted: it boots closed
    await page.keyboard.press("KeyE"); // reopen the way a player would

    await expect(page.locator(PANEL)).toBeVisible();
    expect((await inv(page)).backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 32 });
    await expect(bp(page, 0).locator(".count")).toHaveText("32");
    await expect(bp(page, 0)).toHaveAttribute("aria-label", "Backpack slot 1: 32 stone");
    await expect(bp(page, 0).locator(".icon")).toHaveAttribute("data-block", "stone");
  });

  test("the whole inventory comes back exactly: every slot, every count", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await page.evaluate((b) => {
      const g = (window as any).__game;
      g.simulateInventoryChange(0, null, b.grass, 64);
      g.simulateInventoryChange(3, null, b.dirt, 1);
      g.simulateInventoryChange(8, null, b.stone, 40);
      g.simulateInventoryChange(null, 0, b.stone, 7);
      g.simulateInventoryChange(null, 13, b.wood, 33);
      g.simulateInventoryChange(null, 26, b.sand, 64);
    }, BLOCKS);
    const before = await inv(page);
    await reload(page);
    const after = await inv(page);
    expect(after.hotbar).toEqual(before.hotbar);
    expect(after.backpack).toEqual(before.backpack);
  });

  test("a stack made by dragging persists too", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await page.evaluate((id) => (window as any).__game.simulateInventoryChange(null, 0, id, 32), BLOCKS.stone);
    await openPanel(page);
    const a = (await bp(page, 0).boundingBox())!;
    const b = (await bp(page, 14).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    expect((await inv(page)).backpack[14]).toEqual({ blockId: BLOCKS.stone, count: 32 });

    await reload(page);
    const s = await inv(page);
    expect(s.backpack[14]).toEqual({ blockId: BLOCKS.stone, count: 32 });
    expect(s.backpack[0]).toBeNull();
  });

  test("hotbar contents and the selected slot persist, and the hotbar shows them", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await page.evaluate((id) => (window as any).__game.simulateInventoryChange(4, null, id, 12), BLOCKS.dirt);
    await page.keyboard.press("Digit5"); // select slot index 4
    expect((await inv(page)).selectedHotbarSlot).toBe(4);

    await reload(page);
    const s = await inv(page);
    expect(s.selectedHotbarSlot).toBe(4);
    expect(s.hotbar[4]).toEqual({ blockId: BLOCKS.dirt, count: 12 });
    await expect(hb(page, 4)).toHaveClass(/\bselected\b/);
    await expect(hb(page, 4).locator(".count")).toHaveText("12");
    // And the place handler's view of it, through the same module main.ts imports getSelectedBlock from.
    const placeable = await page.evaluate(async () => {
      const path = "/src/ui/HotbarState.ts";
      return (await import(/* @vite-ignore */ path)).getSelectedBlock() as number;
    });
    expect(placeable).toBe(BLOCKS.dirt);
  });

  test("a later change wins: the last save is what comes back", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await page.evaluate((id) => {
      const g = (window as any).__game;
      for (let n = 1; n <= 20; n++) g.simulateInventoryChange(null, 5, id, n); // rapid-fire, coalesced writes
    }, BLOCKS.stone);
    await reload(page);
    expect((await inv(page)).backpack[5]).toEqual({ blockId: BLOCKS.stone, count: 20 });
  });

  test("a brand-new player gets the starter hotbar and an empty backpack", async ({ page }) => {
    await boot(page);
    const s = await inv(page);
    expect(s.hotbar.slice(0, 3)).toEqual([
      { blockId: BLOCKS.grass, count: MAX },
      { blockId: BLOCKS.dirt, count: MAX },
      { blockId: BLOCKS.stone, count: MAX },
    ]);
    expect(s.hotbar.slice(3).every((x) => x === null)).toBe(true);
    expect(s.backpack.every((x) => x === null)).toBe(true);
    expect(s.selectedHotbarSlot).toBe(0);
  });

  test("a corrupt saved record cannot break boot: bad stacks drop out, the rest loads", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await boot(page);
    // Hand-write a hostile record straight into IndexedDB under the real key, then reload onto it.
    await page.evaluate(({ key, stone }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => open.result.createObjectStore("keyval");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("keyval", "readwrite");
        tx.objectStore("keyval").put({
          version: 1,
          hotbar: [{ blockId: stone, count: 9999 }, { blockId: "x", count: 3 }, { blockId: stone, count: -4 }, null, 7, { count: 2 }],
          backpack: "not an array",
          selectedHotbarSlot: 99,
          flying: true,
          position: { x: 1, y: 2, z: 3 },
          yawPitch: { yaw: 0, pitch: 0 },
        }, key);
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), { key: PLAYER_KEY, stone: BLOCKS.stone });

    await page.reload({ waitUntil: "networkidle" });
    await prepare(page);
    const s = await inv(page);
    expect(s.hotbar).toHaveLength(INVENTORY.HOTBAR_SLOTS);
    expect(s.backpack).toHaveLength(INVENTORY.BACKPACK_SLOTS);
    expect(s.hotbar[0], "an over-cap count is clamped, not rejected").toEqual({ blockId: BLOCKS.stone, count: MAX });
    expect(s.hotbar.slice(1).every((x) => x === null), "malformed stacks become empty").toBe(true);
    expect(s.backpack.every((x) => x === null)).toBe(true);
    expect(s.selectedHotbarSlot, "out-of-range selection falls back to slot 0").toBe(0);
    expect(errors).toEqual([]);
  });
});
