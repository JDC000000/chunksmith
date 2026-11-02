import { test, expect, type Locator, type Page } from "@playwright/test";
import { BLOCKS } from "../../src/world/blocks";
import { INVENTORY } from "../../design/config";

/**
 * US-L4-09 (E opens/closes the backpack), US-L4-10 (stacks cap at 64), US-L4-11 (drag/drop preserves counts),
 * plus the keyboard path, accessibility and screenshot baselines for every new element.
 *
 * Driving the UI:
 *  - Setup goes through the debug API (window.__game.simulateInventoryChange / getInventory), which is the agreed
 *    surface so no test depends on how the inventory is stored.
 *  - Drags use REAL mouse input (page.mouse). Pointer lock is not needed: opening the panel releases it, and in
 *    headless Chromium it is never engaged, so the cursor is free either way.
 *
 * Mounting: main.ts is expected to call initBackpack() and spread createInventoryDebugAPI() into window.__game.
 * Until it does, boot() mounts both itself through the dev server (same pattern as hotbar.spec.ts); once main.ts
 * does it, boot() finds everything in place and leaves it alone. The annotation records which path ran.
 */

const PANEL = '[data-panel="backpack"]';
const MAX = INVENTORY.MAX_STACK_SIZE;
const ANIM_MS = INVENTORY.OPEN_CLOSE_ANIM_MS;

type Stack = { blockId: number; count: number } | null;
interface Inv { hotbar: Stack[]; backpack: Stack[]; selectedHotbarSlot: number }

const panel = (page: Page) => page.locator(PANEL);
const bp = (page: Page, i: number) => page.locator(`${PANEL} .slot[data-index="${i}"]`);
const hb = (page: Page, i: number) => page.locator(`#hotbar .slot[data-index="${i}"]`);

async function boot(page: Page): Promise<void> {
  await page.goto("/?radius=1,1", { waitUntil: "networkidle" });
  await prepare(page);
}

/** Waits for the game, and mounts the inventory UI itself if main.ts has not (yet). */
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
    return "inventory.spec.ts (main.ts integration pending)";
  });
  test.info().annotations.push({ type: "inventory mounted by", description: mountedBy });
}

const inv = (page: Page): Promise<Inv> => page.evaluate(() => (window as any).__game.getInventory());
const total = (s: Inv, blockId: number): number =>
  [...s.hotbar, ...s.backpack].reduce((n, st) => n + (st?.blockId === blockId ? st.count : 0), 0);

/** Every slot to empty (count 0 clears), so assertions are not disturbed by the starter kit. */
async function clearAll(page: Page): Promise<void> {
  await page.evaluate(({ h, b }) => {
    const g = (window as any).__game;
    for (let i = 0; i < h; i++) g.simulateInventoryChange(i, null, 0, 0);
    for (let i = 0; i < b; i++) g.simulateInventoryChange(null, i, 0, 0);
  }, { h: INVENTORY.HOTBAR_SLOTS, b: INVENTORY.BACKPACK_SLOTS });
}

const setHotbar = (page: Page, i: number, blockId: number, count: number) =>
  page.evaluate((a) => (window as any).__game.simulateInventoryChange(a.i, null, a.blockId, a.count), { i, blockId, count });
const setBackpack = (page: Page, i: number, blockId: number, count: number) =>
  page.evaluate((a) => (window as any).__game.simulateInventoryChange(null, a.i, a.blockId, a.count), { i, blockId, count });
const pickUp = (page: Page, blockId: number, count: number) =>
  page.evaluate((a) => (window as any).__game.simulateInventoryChange(null, null, a.blockId, a.count), { blockId, count });

/** Open via the debug API and wait for the entry transition to FINISH, so slot positions are final before we aim a mouse. */
async function openPanel(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__game.openBackpack());
  await page.waitForFunction((sel) => {
    const p = document.querySelector<HTMLElement>(sel);
    if (!p || p.hidden) return false;
    const cs = getComputedStyle(p);
    return cs.opacity === "1" && cs.transform === "none";
  }, PANEL);
}

const centre = async (loc: Locator) => {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** A real pointer drag: press, wiggle past the drag threshold, glide to the target, release. */
async function drag(page: Page, from: Locator, to: Locator, button: "left" | "right" = "left"): Promise<void> {
  const a = await centre(from);
  const b = await centre(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button });
  await page.mouse.move(a.x + 12, a.y + 12, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up({ button });
}

/* ================================ US-L4-09 ===================================================== */

test.describe("US-L4-09 E opens and closes the backpack", () => {
  test("starts hidden; E shows it; E hides it", async ({ page }) => {
    await boot(page);
    const hiddenProp = () => page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).hidden, PANEL);
    expect(await hiddenProp()).toBe(true);
    await expect(panel(page)).toBeHidden();

    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeVisible();
    expect(await hiddenProp()).toBe(false);

    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeHidden();
    expect(await hiddenProp()).toBe(true);
  });

  test("Esc closes it", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });

  test(`close completes inside OPEN_CLOSE_ANIM_MS + 50 ms (${ANIM_MS}+50) and really animates`, async ({ page }) => {
    await boot(page);
    await openPanel(page);
    // Measured in-page from the keydown to the `hidden` flip, so Playwright round-trips are not in the number.
    const ms = await page.evaluate((sel) => new Promise<number>((resolve) => {
      const p = document.querySelector<HTMLElement>(sel)!;
      const obs = new MutationObserver(() => {
        if (p.hidden) { obs.disconnect(); resolve(performance.now() - t0); }
      });
      obs.observe(p, { attributes: true, attributeFilter: ["hidden"] });
      const t0 = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e" }));
    }), PANEL);
    expect(ms, "must not snap shut: the exit transition has to run").toBeGreaterThanOrEqual(ANIM_MS - 20);
    expect(ms).toBeLessThanOrEqual(ANIM_MS + 50);
  });

  test("the transition is transform + opacity over OPEN_CLOSE_ANIM_MS", async ({ page }) => {
    await boot(page);
    const t = await page.evaluate((sel) => {
      const s = getComputedStyle(document.querySelector(sel)!);
      return { props: s.transitionProperty, durations: s.transitionDuration };
    }, PANEL);
    expect(t.props.split(",").map((p) => p.trim()).sort()).toEqual(["opacity", "transform"]);
    for (const d of t.durations.split(",")) expect(parseFloat(d) * 1000).toBeCloseTo(ANIM_MS, 0);
  });

  test("prefers-reduced-motion: no transition, hidden immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await boot(page);
    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("KeyE");
    // No wait: with reduced motion `hidden` flips synchronously.
    expect(await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).hidden, PANEL)).toBe(true);
  });

  test("opening releases pointer lock; closing does not take it back", async ({ page }) => {
    // Headless Chromium cannot hold a real lock, so stub the three pieces the panel touches.
    await page.addInitScript(() => {
      const w = window as any;
      w.__exitCalls = 0;
      w.__lockCalls = 0;
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => document.body });
      document.exitPointerLock = () => { w.__exitCalls++; };
      Element.prototype.requestPointerLock = function () { w.__lockCalls++; } as any;
    });
    await boot(page);
    const calls = () => page.evaluate(() => ({ exit: (window as any).__exitCalls, lock: (window as any).__lockCalls }));
    expect(await calls()).toEqual({ exit: 0, lock: 0 });

    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeVisible();
    expect((await calls()).exit, "E must release the lock").toBe(1);

    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeHidden();
    expect((await calls()).lock, "closing must not force the lock back").toBe(0);
  });

  test("a lock engaging while open closes the panel", async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await page.evaluate(() => {
      // Pretend something called lock(): the property reports a locked element, then pointerlockchange fires.
      Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => document.body });
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    await expect(panel(page)).toBeHidden();
  });

  test("Ctrl+E and key-repeat do not toggle", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Control+KeyE");
    await expect(panel(page)).toBeHidden();
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", repeat: true })));
    await expect(panel(page)).toBeHidden();
    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeVisible();
    // Holding E auto-repeats keydown: that must not flip it straight back shut.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", repeat: true })));
    await expect(panel(page)).toBeVisible();
  });

  test("the open panel is a centred 3x9 grid of 27 slots over the game, not inside the canvas", async ({ page }) => {
    await boot(page);
    await openPanel(page);
    await expect(page.locator(`${PANEL} .slot`)).toHaveCount(INVENTORY.BACKPACK_SLOTS);
    const g = await page.evaluate((sel) => {
      const p = document.querySelector<HTMLElement>(sel)!;
      const r = p.getBoundingClientRect();
      const ys = [...p.querySelectorAll<HTMLElement>(".slot")].map((s) => Math.round(s.getBoundingClientRect().top));
      return {
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        rows: new Set(ys).size,
        inCanvasParent: !!p.closest("canvas, #app"),
        position: getComputedStyle(p).position,
      };
    }, PANEL);
    const vp = page.viewportSize()!;
    expect(g.cx).toBeCloseTo(vp.width / 2, 0);
    expect(g.cy).toBeCloseTo(vp.height / 2, 0);
    expect(g.rows).toBe(3);
    expect(g.inCanvasParent).toBe(false);
    expect(g.position).toBe("fixed");
  });

  test("the click-to-play card is hidden while open and returns after close", async ({ page }) => {
    await boot(page);
    const display = () => page.evaluate(() => { const o = document.querySelector("#overlay"); return o ? getComputedStyle(o).display : "absent"; });
    const before = await display();
    test.skip(before === "absent", "no #overlay in this build");
    await openPanel(page);
    expect(await display()).toBe("none");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect.poll(display).toBe(before);
  });
});

/* ================================ US-L4-10 ===================================================== */

test.describe("US-L4-10 stacks cap at INVENTORY.MAX_STACK_SIZE", () => {
  test("a fresh game has the L2 hotbar (grass, dirt, stone) and an empty backpack", async ({ page }) => {
    await boot(page);
    const s = await inv(page);
    expect(s.hotbar.slice(0, 3).map((x) => x?.blockId)).toEqual([BLOCKS.grass, BLOCKS.dirt, BLOCKS.stone]);
    expect(s.hotbar).toHaveLength(INVENTORY.HOTBAR_SLOTS);
    expect(s.backpack).toHaveLength(INVENTORY.BACKPACK_SLOTS);
    expect(s.backpack.every((x) => x === null)).toBe(true);
    expect(s.selectedHotbarSlot).toBe(0);
  });

  test("one more onto a full stack: the full stack stays 64, the extra lands in the next free slot", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setHotbar(page, 0, BLOCKS.stone, MAX);
    await pickUp(page, BLOCKS.stone, 1);
    const s = await inv(page);
    expect(s.hotbar[0]).toEqual({ blockId: BLOCKS.stone, count: MAX });
    expect(s.hotbar[1]).toEqual({ blockId: BLOCKS.stone, count: 1 });
    expect(total(s, BLOCKS.stone)).toBe(MAX + 1);
  });

  test("picking up 65 at once: 64 + 1, nothing lost", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await pickUp(page, BLOCKS.dirt, MAX + 1);
    const s = await inv(page);
    expect(s.hotbar[0]).toEqual({ blockId: BLOCKS.dirt, count: MAX });
    expect(s.hotbar[1]).toEqual({ blockId: BLOCKS.dirt, count: 1 });
    expect(total(s, BLOCKS.dirt)).toBe(MAX + 1);
  });

  test("tops up a part-full stack before opening a new slot", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 3, BLOCKS.stone, MAX - 4);
    await pickUp(page, BLOCKS.stone, 10);
    const s = await inv(page);
    expect(s.backpack[3]).toEqual({ blockId: BLOCKS.stone, count: MAX });
    expect(s.hotbar[0]).toEqual({ blockId: BLOCKS.stone, count: 6 });
    expect(total(s, BLOCKS.stone)).toBe(MAX - 4 + 10);
  });

  test("setting a slot above the cap clamps to the cap", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, MAX * 2);
    expect((await inv(page)).backpack[0]).toEqual({ blockId: BLOCKS.stone, count: MAX });
  });

  test("a completely full inventory takes no more, and no slot ever exceeds the cap", async ({ page }) => {
    await boot(page);
    await page.evaluate(({ h, b, id, max }) => {
      const g = (window as any).__game;
      for (let i = 0; i < h; i++) g.simulateInventoryChange(i, null, id, max);
      for (let i = 0; i < b; i++) g.simulateInventoryChange(null, i, id, max);
      g.simulateInventoryChange(null, null, id, 5); // no room anywhere
    }, { h: INVENTORY.HOTBAR_SLOTS, b: INVENTORY.BACKPACK_SLOTS, id: BLOCKS.stone, max: MAX });
    const s = await inv(page);
    expect(total(s, BLOCKS.stone)).toBe((INVENTORY.HOTBAR_SLOTS + INVENTORY.BACKPACK_SLOTS) * MAX);
    for (const st of [...s.hotbar, ...s.backpack]) expect(st!.count).toBeLessThanOrEqual(MAX);
  });

  test("the slot shows the count, and hides it when the count is 1", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, MAX);
    await setBackpack(page, 1, BLOCKS.stone, 1);
    await setBackpack(page, 2, BLOCKS.dirt, 7);
    await openPanel(page);
    await expect(bp(page, 0).locator(".count")).toHaveText(String(MAX));
    await expect(bp(page, 2).locator(".count")).toHaveText("7");
    await expect(bp(page, 1).locator(".count")).toBeHidden();
    await expect(bp(page, 1).locator(".count")).toHaveText("");
    await expect(bp(page, 3).locator(".count")).toBeHidden(); // empty
    // Count is a number, and the slot's accessible name carries count + block, so colour is never the only cue.
    await expect(bp(page, 0)).toHaveAttribute("aria-label", `Backpack slot 1: ${MAX} stone`);
    await expect(bp(page, 1)).toHaveAttribute("aria-label", "Backpack slot 2: 1 stone");
    await expect(bp(page, 3)).toHaveAttribute("aria-label", "Backpack slot 4: empty");
  });
});

/* ================================ US-L4-11 ===================================================== */

test.describe("US-L4-11 drag and drop preserves counts", () => {
  test("a 32-stack dropped on an empty slot moves whole; totals match", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    const before = await inv(page);
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 5));
    const after = await inv(page);
    expect(after.backpack[5]).toEqual({ blockId: BLOCKS.stone, count: 32 });
    expect(after.backpack[0]).toBeNull();
    expect(total(after, BLOCKS.stone)).toBe(total(before, BLOCKS.stone));
    // The DOM follows the state.
    await expect(bp(page, 5).locator(".count")).toHaveText("32");
    await expect(bp(page, 0)).toHaveAttribute("data-empty", "true");
  });

  test("32 dropped on a 20-stack of the same block makes one 52-stack", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    await setBackpack(page, 5, BLOCKS.stone, 20);
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 5));
    const s = await inv(page);
    expect(s.backpack[5]).toEqual({ blockId: BLOCKS.stone, count: 52 });
    expect(s.backpack[0]).toBeNull();
    expect(total(s, BLOCKS.stone)).toBe(52);
  });

  test("over the cap: the target fills to 64 and the overflow stays with the source (PRD example 30 + 40)", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setHotbar(page, 0, BLOCKS.grass, 30);
    await setBackpack(page, 5, BLOCKS.grass, 40);
    await openPanel(page);
    await drag(page, hb(page, 0), bp(page, 5));
    const s = await inv(page);
    expect(s.backpack[5]).toEqual({ blockId: BLOCKS.grass, count: MAX });
    expect(s.hotbar[0]).toEqual({ blockId: BLOCKS.grass, count: 6 });
    expect(total(s, BLOCKS.grass)).toBe(70);
  });

  test("40 onto 40 gives 64 + 16", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 40);
    await setBackpack(page, 1, BLOCKS.stone, 40);
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 1));
    const s = await inv(page);
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.stone, count: MAX });
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 16 });
  });

  test("a full stack dropped on a full stack of the same block changes nothing", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, MAX);
    await setBackpack(page, 1, BLOCKS.stone, MAX);
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 1));
    const s = await inv(page);
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: MAX });
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.stone, count: MAX });
  });

  test("dropping on a different block swaps the two stacks", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 10);
    await setBackpack(page, 1, BLOCKS.dirt, 20);
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 1));
    const s = await inv(page);
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.dirt, count: 20 });
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.stone, count: 10 });
  });

  test("works freely between the lanes: hotbar to backpack, backpack to hotbar, and within the hotbar", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setHotbar(page, 2, BLOCKS.stone, 12);
    await setBackpack(page, 10, BLOCKS.dirt, 9);
    await openPanel(page);

    await drag(page, hb(page, 2), bp(page, 20)); // hotbar -> backpack
    let s = await inv(page);
    expect(s.hotbar[2]).toBeNull();
    expect(s.backpack[20]).toEqual({ blockId: BLOCKS.stone, count: 12 });

    await drag(page, bp(page, 10), hb(page, 7)); // backpack -> hotbar
    s = await inv(page);
    expect(s.backpack[10]).toBeNull();
    expect(s.hotbar[7]).toEqual({ blockId: BLOCKS.dirt, count: 9 });

    await drag(page, hb(page, 7), hb(page, 1)); // within the hotbar
    s = await inv(page);
    expect(s.hotbar[7]).toBeNull();
    expect(s.hotbar[1]).toEqual({ blockId: BLOCKS.dirt, count: 9 });

    await drag(page, bp(page, 20), bp(page, 26)); // within the backpack
    s = await inv(page);
    expect(s.backpack[26]).toEqual({ blockId: BLOCKS.stone, count: 12 });
    expect(total(s, BLOCKS.stone)).toBe(12);
    expect(total(s, BLOCKS.dirt)).toBe(9);
  });

  test("right-button drag lifts HALF, rounded up; the source keeps the rest", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 33);
    await setBackpack(page, 10, BLOCKS.dirt, 10);
    await setBackpack(page, 20, BLOCKS.grass, 1);
    await openPanel(page);

    await drag(page, bp(page, 0), bp(page, 1), "right");
    let s = await inv(page);
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.stone, count: 17 });
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 16 });

    await drag(page, bp(page, 10), bp(page, 11), "right"); // even
    s = await inv(page);
    expect(s.backpack[10]).toEqual({ blockId: BLOCKS.dirt, count: 5 });
    expect(s.backpack[11]).toEqual({ blockId: BLOCKS.dirt, count: 5 });

    await drag(page, bp(page, 20), bp(page, 21), "right"); // a lone item: half rounded up is the item
    s = await inv(page);
    expect(s.backpack[20]).toBeNull();
    expect(s.backpack[21]).toEqual({ blockId: BLOCKS.grass, count: 1 });

    expect(total(s, BLOCKS.stone)).toBe(33);
  });

  test("a split onto the same block merges only what fits; the rest stays", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 40); // lifts 20
    await setBackpack(page, 1, BLOCKS.stone, 50); // room for 14
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 1), "right");
    const s = await inv(page);
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.stone, count: MAX });
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 26 });
    expect(total(s, BLOCKS.stone)).toBe(90);
  });

  test("a split onto a different block is refused (no partial swap); nothing changes", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 10);
    await setBackpack(page, 1, BLOCKS.dirt, 10);
    await openPanel(page);
    await drag(page, bp(page, 0), bp(page, 1), "right");
    const s = await inv(page);
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 10 });
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.dirt, count: 10 });
  });

  test("while dragging: a ghost with the lifted count follows the cursor, source is marked, target is highlighted", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 33);
    await openPanel(page);
    const a = await centre(bp(page, 0));
    const b = await centre(bp(page, 4));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: "right" });
    await expect(page.locator(".drag-ghost"), "no ghost until the pointer travels past the threshold").toHaveCount(0);
    await page.mouse.move(b.x, b.y, { steps: 6 });

    await expect(page.locator(".drag-ghost")).toHaveCount(1);
    await expect(page.locator(".drag-ghost .count")).toHaveText("17");
    await expect(bp(page, 0)).toHaveClass(/\bis-lifted\b/);
    await expect(bp(page, 4)).toHaveClass(/\bdrop-target\b/);
    const g = (await page.locator(".drag-ghost").boundingBox())!;
    expect(g.x + g.width / 2).toBeCloseTo(b.x, 0);
    expect(g.y + g.height / 2).toBeCloseTo(b.y, 0);
    // Nothing has moved yet: the drop is the only mutation.
    expect((await inv(page)).backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 33 });

    await page.mouse.up({ button: "right" });
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
    await expect(page.locator(`${PANEL} .is-lifted, ${PANEL} .drop-target`)).toHaveCount(0);
    expect((await inv(page)).backpack[4]).toEqual({ blockId: BLOCKS.stone, count: 17 });
  });

  test("releasing outside any slot cancels: nothing moves, nothing is lost", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    await openPanel(page);
    const a = await centre(bp(page, 0));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y + 20, { steps: 3 });
    await page.mouse.move(8, 8, { steps: 6 }); // empty corner of the game view
    await page.mouse.up();
    const s = await inv(page);
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 32 });
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
  });

  test("Esc mid-drag closes the panel, cancels the drag, and loses nothing", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    await openPanel(page);
    const a = await centre(bp(page, 0));
    const b = await centre(bp(page, 5));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await expect(page.locator(".drag-ghost")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
    await page.mouse.up(); // late release must be inert
    const s = await inv(page);
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 32 });
    expect(s.backpack[5]).toBeNull();
  });

  test("a press without travel is a click, not a drag", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    await openPanel(page);
    const a = await centre(bp(page, 0));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 2, a.y + 1); // under the 4px threshold
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
    await page.mouse.up();
    expect((await inv(page)).backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 32 });
  });

  test("drag is live only while the panel is open; closed, the hotbar just selects", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setHotbar(page, 0, BLOCKS.stone, 12);
    await drag(page, hb(page, 0), hb(page, 4));
    let s = await inv(page);
    expect(s.hotbar[0]).toEqual({ blockId: BLOCKS.stone, count: 12 });
    expect(s.hotbar[4]).toBeNull();
    await hb(page, 3).click();
    expect((await inv(page)).selectedHotbarSlot).toBe(3);

    // Same drag with the panel open does move it.
    await openPanel(page);
    await drag(page, hb(page, 0), hb(page, 4));
    s = await inv(page);
    expect(s.hotbar[4]).toEqual({ blockId: BLOCKS.stone, count: 12 });
  });

  test("dragging hotbar slots does not change which slot is selected; a plain click still does", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setHotbar(page, 1, BLOCKS.stone, 5);
    await openPanel(page);
    await page.keyboard.press("Digit1");
    expect((await inv(page)).selectedHotbarSlot).toBe(0);
    await drag(page, hb(page, 1), hb(page, 6));
    expect((await inv(page)).selectedHotbarSlot, "ending a drag on slot 6 must not select it").toBe(0);
    expect((await inv(page)).hotbar[6]).toEqual({ blockId: BLOCKS.stone, count: 5 });
    await hb(page, 6).click();
    expect((await inv(page)).selectedHotbarSlot).toBe(6);
  });

  test("a drag that ends back on its own hotbar slot is a cancel, not a click: it must not select that slot", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setHotbar(page, 5, BLOCKS.stone, 5);
    await openPanel(page);
    await page.keyboard.press("Digit1");
    const a = await centre(hb(page, 5));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x, a.y - 60, { steps: 4 }); // out past the threshold and over empty game view
    await page.mouse.move(a.x, a.y, { steps: 4 }); // and back onto the SAME slot: the browser now sends it a click
    await page.mouse.up();
    const s = await inv(page);
    expect(s.hotbar[5]).toEqual({ blockId: BLOCKS.stone, count: 5 });
    expect(s.selectedHotbarSlot, "the click that follows a drag is swallowed").toBe(0);
  });

  test("a right-click on a slot never opens the browser menu while the panel is open", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 4);
    await openPanel(page);
    const prevented = await page.evaluate((sel) => {
      const slot = document.querySelector(`${sel} .slot`)!;
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      slot.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, PANEL);
    expect(prevented).toBe(true);
  });
});

/* ============================ keyboard path + accessibility ==================================== */

test.describe("keyboard path (PRD-L4 section 2.5)", () => {
  test("Tab reaches the backpack button; Enter opens the panel and moves focus into the grid", async ({ page }) => {
    await boot(page);
    let reached = false;
    for (let i = 0; i < 24 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.id === "backpack-toggle");
    }
    expect(reached, "Tab never reached #backpack-toggle").toBe(true);
    const toggle = page.locator("#backpack-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "backpack-panel");

    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate((sel) => document.activeElement?.closest(sel) !== null, PANEL)).toBe(true);
  });

  test("the grid is one tab stop and there is no focus trap", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("KeyE");
    await expect(panel(page)).toBeVisible();
    const tabbable = await page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(`${sel} .slot`)].filter((s) => s.tabIndex >= 0).length, PANEL);
    expect(tabbable).toBe(1);
    let left = false;
    for (let i = 0; i < 4 && !left; i++) {
      await page.keyboard.press("Tab");
      left = await page.evaluate((sel) => !document.activeElement?.closest(sel), PANEL);
    }
    expect(left, "Tab must be able to leave the panel").toBe(true);
  });

  test("Space picks up, arrows move, Space drops: within the backpack and down into the hotbar", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 12);
    await page.keyboard.press("KeyE"); // focus lands on backpack slot 0
    await expect(bp(page, 0)).toBeFocused();

    await page.keyboard.press("Space"); // pick up
    await expect(bp(page, 0)).toHaveClass(/\bis-lifted\b/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(bp(page, 2)).toBeFocused();
    await expect(bp(page, 2)).toHaveClass(/\bdrop-target\b/);
    await page.keyboard.press("Space"); // drop
    let s = await inv(page);
    expect(s.backpack[2]).toEqual({ blockId: BLOCKS.stone, count: 12 });
    expect(s.backpack[0]).toBeNull();
    await expect(page.locator(`${PANEL} [role="status"]`)).toContainText("Dropped 12 stone");

    // Down through the remaining backpack rows (row 0 -> 1 -> 2) and into the hotbar row.
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(hb(page, 2)).toBeFocused();
    await page.keyboard.press("Space");
    s = await inv(page);
    expect(s.hotbar[2]).toEqual({ blockId: BLOCKS.stone, count: 12 });
    expect(s.backpack[2]).toBeNull();
    expect(s.selectedHotbarSlot, "Space on a hotbar slot must drop, not select").toBe(0);
  });

  test("Shift+Space picks up half, rounded up", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 9);
    await page.keyboard.press("KeyE");
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    const s = await inv(page);
    expect(s.backpack[1]).toEqual({ blockId: BLOCKS.stone, count: 5 });
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 4 });
  });

  test("a refused drop keeps carrying so another slot can be tried; dropping on the source cancels", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 10);
    await setBackpack(page, 1, BLOCKS.dirt, 10);
    await page.keyboard.press("KeyE");
    await page.keyboard.press("Shift+Space"); // lift 5
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space"); // partial onto a different block: refused
    await expect(bp(page, 0)).toHaveClass(/\bis-lifted\b/);
    expect((await inv(page)).backpack[1]).toEqual({ blockId: BLOCKS.dirt, count: 10 });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space"); // empty slot 2: accepted
    const s = await inv(page);
    expect(s.backpack[2]).toEqual({ blockId: BLOCKS.stone, count: 5 });
    expect(s.backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 5 });

    // Lift again, drop on the source: cancel.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    await expect(bp(page, 0)).toHaveClass(/\bis-lifted\b/);
    await page.keyboard.press("Space");
    await expect(bp(page, 0)).not.toHaveClass(/\bis-lifted\b/);
    expect((await inv(page)).backpack[0]).toEqual({ blockId: BLOCKS.stone, count: 5 });
  });

  test("arrow keys clamp at the edges; Home/End jump to the row ends", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("KeyE");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    await expect(bp(page, 0)).toBeFocused();
    await page.keyboard.press("End");
    await expect(bp(page, 8)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(bp(page, 8)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(bp(page, 0)).toBeFocused();
  });

  test("closing with Esc hands focus back out of the panel", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("KeyE");
    await expect(bp(page, 0)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    expect(await page.evaluate((sel) => !document.activeElement?.closest(sel), PANEL)).toBe(true);
  });

  test("semantics: dialog labelled by its title, slots labelled, live region present", async ({ page }) => {
    await boot(page);
    await expect(panel(page)).toHaveAttribute("role", "dialog");
    await expect(panel(page)).toHaveAttribute("aria-modal", "false");
    await expect(panel(page)).toHaveAttribute("aria-labelledby", "backpack-title");
    await expect(page.locator("#backpack-title")).toHaveText("Backpack");
    await expect(page.locator(`${PANEL} [role="status"]`)).toHaveAttribute("aria-live", "polite");
    for (const el of await page.locator(`${PANEL} .slot`).all()) expect(await el.getAttribute("aria-label")).toMatch(/^Backpack slot \d+: /);
    await expect(hb(page, 0)).toHaveAttribute("aria-label", `Hotbar slot 1: ${MAX} grass`);
  });
});

/* ================================ WCAG AA ====================================================== */

type RGB = [number, number, number];
type RGBA = [number, number, number, number];
const parse = (css: string): RGBA => {
  const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) throw new Error(`unparseable colour: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
};
const over = ([r, g, b, a]: RGBA, bg: RGB): RGB => [r, g, b].map((c, i) => c * a + bg[i]! * (1 - a)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// Everything the panel can sit on: scene sky (main.ts), pure white (worst bright case), L3 night, black.
const BACKDROPS: Record<string, RGB> = {
  daylight: [0x87, 0xce, 0xeb],
  white: [255, 255, 255],
  night: [0x05, 0x07, 0x0f],
  black: [0, 0, 0],
};

test.describe("WCAG AA contrast", () => {
  test("panel title, hint, block names and counts are >= 4.5:1 on daylight, white, night and black", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    await setHotbar(page, 0, BLOCKS.dirt, 12);
    await openPanel(page);
    const css = await page.evaluate((sel) => {
      const c = (e: Element, p: "color" | "backgroundColor") => getComputedStyle(e)[p];
      const p = document.querySelector(sel)!;
      const slot = p.querySelector(".slot[data-index='0']")!;
      const hot = document.querySelector("#hotbar .slot[data-index='0']")!;
      return {
        panelBg: c(p, "backgroundColor"),
        title: c(p.querySelector("h2")!, "color"),
        hint: c(p.querySelector(".hint")!, "color"),
        slotPlate: c(slot, "backgroundColor"),
        slotName: c(slot.querySelector(".name")!, "color"),
        slotCount: c(slot.querySelector(".count")!, "color"),
        slotCountPill: c(slot.querySelector(".count")!, "backgroundColor"),
        hotPlate: c(hot, "backgroundColor"),
        hotName: c(hot.querySelector(".name")!, "color"),
        hotCount: c(hot.querySelector(".count")!, "color"),
        hotCountPill: c(hot.querySelector(".count")!, "backgroundColor"),
        toggleBg: c(document.querySelector("#backpack-toggle")!, "backgroundColor"),
        toggleText: c(document.querySelector("#backpack-toggle")!, "color"),
      };
    }, PANEL);

    for (const [name, backdrop] of Object.entries(BACKDROPS)) {
      const panelBg = over(parse(css.panelBg), backdrop);
      expect(ratio(over(parse(css.title), panelBg), panelBg), `title on ${name}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(over(parse(css.hint), panelBg), panelBg), `hint on ${name}`).toBeGreaterThanOrEqual(4.5);

      // Backpack slots sit on the panel; hotbar slots sit directly on the game view.
      const slotPlate = over(parse(css.slotPlate), panelBg);
      expect(ratio(over(parse(css.slotName), slotPlate), slotPlate), `backpack block name on ${name}`).toBeGreaterThanOrEqual(4.5);
      const slotPill = over(parse(css.slotCountPill), slotPlate);
      expect(ratio(over(parse(css.slotCount), slotPill), slotPill), `backpack count on ${name}`).toBeGreaterThanOrEqual(4.5);

      const hotPlate = over(parse(css.hotPlate), backdrop);
      expect(ratio(over(parse(css.hotName), hotPlate), hotPlate), `hotbar block name on ${name}`).toBeGreaterThanOrEqual(4.5);
      const hotPill = over(parse(css.hotCountPill), hotPlate);
      expect(ratio(over(parse(css.hotCount), hotPill), hotPill), `hotbar count on ${name}`).toBeGreaterThanOrEqual(4.5);

      const toggleBg = over(parse(css.toggleBg), backdrop);
      expect(ratio(over(parse(css.toggleText), toggleBg), toggleBg), `toggle label on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the drop-target ring is >= 3:1 against its plate, and the plate keeps the label legible", async ({ page }) => {
    await boot(page);
    await clearAll(page);
    await setBackpack(page, 0, BLOCKS.stone, 32);
    await openPanel(page);
    await page.evaluate((sel) => document.querySelector(`${sel} .slot[data-index='0']`)!.classList.add("drop-target"), PANEL);
    const css = await page.evaluate((sel) => {
      const slot = document.querySelector(`${sel} .slot[data-index='0']`)!;
      const s = getComputedStyle(slot);
      return {
        border: s.borderTopColor, plate: s.backgroundColor, text: getComputedStyle(slot.querySelector(".name")!).color,
        panelBg: getComputedStyle(document.querySelector(sel)!).backgroundColor,
      };
    }, PANEL);
    for (const [name, backdrop] of Object.entries(BACKDROPS)) {
      const panelBg = over(parse(css.panelBg), backdrop);
      const plate = over(parse(css.plate), panelBg);
      expect(ratio(over(parse(css.border), plate), plate), `drop-target ring on ${name}`).toBeGreaterThanOrEqual(3);
      expect(ratio(over(parse(css.text), plate), plate), `drop-target label on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/* ================================ screenshot baselines ========================================= */
// As in hotbar.spec.ts: the WebGL canvas is hidden and the page is flooded with a flat backdrop so the pixels are
// the UI's own. Glyph FILL is made transparent (font is machine-dependent; text is asserted via toHaveText and the
// contrast tests above) while borders, plates, pills and icons are pinned. Motion is reduced so transitions are
// instant. Per CLAUDE.md, (re)generate baselines in the pinned Docker image:
//   npx playwright test inventory --update-snapshots

const BACKDROP_CSS = { daylight: "#87ceeb", night: "#05070f" } as const;

async function stage(page: Page, backdrop: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await boot(page);
  await clearAll(page);
  // A fixed, varied fill: full, odd, single (count hidden), different blocks, spread over rows and both lanes.
  await page.evaluate(({ stone, dirt, grass, wood, sand, snow }) => {
    const g = (window as any).__game;
    g.simulateInventoryChange(0, null, grass, 64);
    g.simulateInventoryChange(1, null, dirt, 17);
    g.simulateInventoryChange(2, null, stone, 1);
    g.simulateInventoryChange(null, 0, stone, 64);
    g.simulateInventoryChange(null, 1, dirt, 32);
    g.simulateInventoryChange(null, 2, grass, 1);
    g.simulateInventoryChange(null, 9, wood, 7);
    g.simulateInventoryChange(null, 13, sand, 48);
    g.simulateInventoryChange(null, 26, snow, 5);
  }, { stone: BLOCKS.stone, dirt: BLOCKS.dirt, grass: BLOCKS.grass, wood: BLOCKS.wood, sand: BLOCKS.sand, snow: BLOCKS.snow });
  await page.addStyleTag({
    content:
      `#app, #overlay { display: none !important } html, body { background: ${backdrop} !important }` +
      ` #hotbar, #hotbar *, #backpack-toggle, #backpack-toggle *, [data-panel="backpack"], [data-panel="backpack"] *, .drag-ghost *` +
      ` { -webkit-text-fill-color: transparent !important }`,
  });
}

const blurFocus = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

for (const [name, backdrop] of Object.entries(BACKDROP_CSS)) {
  test(`screenshot baseline: backpack panel, ${name}`, async ({ page }) => {
    await stage(page, backdrop);
    await openPanel(page);
    await blurFocus(page);
    await expect(panel(page)).toHaveScreenshot(`backpack-${name}.png`);
  });

  test(`screenshot baseline: 9-slot hotbar with icons and counts, ${name}`, async ({ page }) => {
    await stage(page, backdrop);
    await expect(page.locator("#hotbar")).toHaveScreenshot(`hotbar-inventory-${name}.png`);
  });

  test(`screenshot baseline: backpack toggle button, ${name}`, async ({ page }) => {
    await stage(page, backdrop);
    await expect(page.locator("#backpack-toggle")).toHaveScreenshot(`backpack-toggle-${name}.png`);
  });
}

test("screenshot baseline: hotbar with slot 5 selected and a drop-target ring", async ({ page }) => {
  await stage(page, BACKDROP_CSS.daylight);
  await page.keyboard.press("Digit5");
  await page.evaluate(() => document.querySelector("#hotbar .slot[data-index='4']")!.classList.add("drop-target"));
  await page.evaluate(() => document.querySelector("#hotbar .slot[data-index='0']")!.classList.add("is-lifted"));
  await expect(page.locator("#hotbar")).toHaveScreenshot("hotbar-inventory-states.png");
});

test("screenshot baseline: mid-drag (ghost, lifted source, drop target)", async ({ page }) => {
  await stage(page, BACKDROP_CSS.daylight);
  await openPanel(page);
  await blurFocus(page);
  const a = await centre(bp(page, 0));
  const b = await centre(bp(page, 12));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x + 6, b.y + 6, { steps: 6 });
  await expect(page.locator(".drag-ghost")).toHaveCount(1);
  const box = (await panel(page).boundingBox())!;
  await expect(page).toHaveScreenshot("backpack-dragging.png", {
    clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
  });
  await page.mouse.up();
});
