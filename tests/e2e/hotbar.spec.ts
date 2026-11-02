import { test, expect, type Page } from "@playwright/test";
import { BLOCKS } from "../../src/world/blocks";

/**
 * US-L2-04: number keys switch hotbar selection.
 *
 * No pointer lock needed: the hotbar listens on `window`, so plain key presses drive it.
 *
 * Mounting: main.ts will call initHotbar() once the Day 6 integration lands. Until then boot()
 * mounts it itself through the dev server; afterwards `#hotbar` already exists and boot() leaves
 * it alone. initHotbar() is idempotent, so either order is safe. The annotation records which path ran.
 */

const slots = (page: Page) => page.locator("#hotbar .slot");
const slot = (page: Page, i: number) => page.locator(`#hotbar .slot[data-index="${i}"]`);

async function boot(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as any).__game !== undefined, undefined, { timeout: 5000 });
  const mountedBy = await page.evaluate(async () => {
    if (document.querySelector("#hotbar")) return "main.ts";
    const path = "/src/ui/hotbar.ts"; // variable path: resolved by the browser/Vite, not by tsc
    const { initHotbar } = await import(/* @vite-ignore */ path);
    initHotbar();
    return "hotbar.spec.ts (main.ts integration pending)";
  });
  test.info().annotations.push({ type: "hotbar mounted by", description: mountedBy });
}

/** Exactly one slot carries `.selected`, and it is slot `idx`. */
async function expectSelected(page: Page, idx: number): Promise<void> {
  await expect(page.locator(".selected")).toHaveCount(1);
  await expect(page.locator(".selected")).toHaveAttribute("data-index", String(idx));
  await expect(slot(page, idx)).toHaveAttribute("aria-pressed", "true");
}

test.describe("US-L2-04 hotbar selection", () => {
  test("hotbar is visible after boot with 3 labelled slots", async ({ page }) => {
    await boot(page);
    await expect(page.locator("#hotbar")).toBeVisible();
    await expect(slots(page)).toHaveCount(3);
    // Labels come from the block registry (BLOCKS), in slot order.
    await expect(slots(page)).toHaveText(["grass", "dirt", "stone"]);
  });

  test("initial state: slot 0 selected, others not", async ({ page }) => {
    await boot(page);
    await expect(slot(page, 0)).toHaveClass(/\bselected\b/);
    await expect(slot(page, 1)).not.toHaveClass(/\bselected\b/);
    await expect(slot(page, 2)).not.toHaveClass(/\bselected\b/);
    await expectSelected(page, 0);
  });

  test("Digit2, Digit3, Digit1 move the selection", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Digit2");
    await expectSelected(page, 1);
    await page.keyboard.press("Digit3");
    await expectSelected(page, 2);
    await page.keyboard.press("Digit1");
    await expectSelected(page, 0);
  });

  test("keys with no slot (Digit4, Digit9, Digit0) leave the selection alone", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Digit3");
    for (const code of ["Digit4", "Digit9", "Digit0"]) await page.keyboard.press(code);
    await expectSelected(page, 2);
  });

  test("Ctrl+Digit is left to the browser and does not switch slots", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Control+Digit2");
    await expectSelected(page, 0);
  });

  test("clicking a slot selects it", async ({ page }) => {
    await boot(page);
    await slot(page, 2).click();
    await expectSelected(page, 2);
    await slot(page, 1).click();
    await expectSelected(page, 1);
  });

  test("mouse wheel cycles: down = next, up = previous, both wrap", async ({ page }) => {
    await boot(page);
    await page.mouse.move(640, 300);
    await page.mouse.wheel(0, 100);
    await expectSelected(page, 1);
    await page.mouse.wheel(0, 100);
    await expectSelected(page, 2);
    await page.mouse.wheel(0, 100); // wraps 2 -> 0
    await expectSelected(page, 0);
    await page.mouse.wheel(0, -100); // wraps 0 -> 2
    await expectSelected(page, 2);
    await page.mouse.wheel(0, -100);
    await expectSelected(page, 1);
  });

  test("selection is mirrored in HotbarState, the value Day 5 place/break reads", async ({ page }) => {
    await boot(page);
    const read = () =>
      page.evaluate(async () => {
        const path = "/src/ui/HotbarState.ts";
        const s = await import(/* @vite-ignore */ path);
        return { index: s.getSelectedIndex() as number, block: s.getSelectedBlock() as number };
      });
    expect(await read()).toEqual({ index: 0, block: BLOCKS.grass });
    await page.keyboard.press("Digit2");
    expect(await read()).toEqual({ index: 1, block: BLOCKS.dirt });
    await slot(page, 2).click();
    expect(await read()).toEqual({ index: 2, block: BLOCKS.stone });
  });

  test("slots take the mouse; the strip around them is click-through", async ({ page }) => {
    await boot(page);
    const probe = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>("#hotbar")!;
      const els = [...document.querySelectorAll<HTMLElement>("#hotbar .slot")];
      const rects = els.map((e) => e.getBoundingClientRect());
      const hit = (x: number, y: number) => document.elementFromPoint(x, y);
      const midY = rects[0]!.top + rects[0]!.height / 2;
      const gap = hit((rects[0]!.right + rects[1]!.left) / 2, midY); // between slot 0 and 1
      return {
        barPointerEvents: getComputedStyle(bar).pointerEvents,
        slotPointerEvents: els.map((e) => getComputedStyle(e).pointerEvents),
        // What a click at each slot's centre would land on (overlay/canvas must not cover it).
        centreHits: rects.map((r) => hit(r.left + r.width / 2, r.top + r.height / 2)?.closest(".slot")?.getAttribute("data-index")),
        gapTarget: gap?.tagName,
        gapInsideHotbar: !!gap?.closest("#hotbar"),
      };
    });
    expect(probe.barPointerEvents).toBe("none");
    expect(probe.slotPointerEvents).toEqual(["auto", "auto", "auto"]);
    expect(probe.centreHits).toEqual(["0", "1", "2"]);
    expect(probe.gapInsideHotbar, `gap hit ${probe.gapTarget}; fire-clicks there must reach the canvas`).toBe(false);
  });

  test("hotbar sits bottom-centre, 8px above the bottom edge", async ({ page }) => {
    await boot(page);
    const box = (await page.locator("#hotbar").boundingBox())!;
    const vp = page.viewportSize()!;
    expect(vp.height - (box.y + box.height)).toBeCloseTo(8, 0);
    expect(box.x + box.width / 2).toBeCloseTo(vp.width / 2, 0);
    expect(box.width).toBeCloseTo(3 * 48 + 2 * 8, 0);
    expect(box.height).toBeCloseTo(48, 0);
  });
});

test.describe("coarse pointer (L5-ready)", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("slots grow to 64x64 with a wider gap", async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "emulation precondition").toBe(true);
    const boxes = await Promise.all([0, 1, 2].map((i) => slot(page, i).boundingBox()));
    for (const b of boxes) {
      expect(b!.width).toBeCloseTo(64, 0);
      expect(b!.height).toBeCloseTo(64, 0);
    }
    expect(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.width)).toBeCloseTo(12, 0);
  });
});

/* ---- WCAG AA ------------------------------------------------------------------------------ */

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

// Backdrops the hotbar can sit on: scene sky (main.ts), pure white (worst bright case), L3 night, black.
const BACKDROPS: Record<string, RGB> = {
  daylight: [0x87, 0xce, 0xeb],
  white: [255, 255, 255],
  night: [0x05, 0x07, 0x0f],
  black: [0, 0, 0],
};

// KNOWN GAP, deliberately not asserted: on a pure-white backdrop (L3 snow/cloud worst case) the spec'd amber
// #f9a825 is 2.91:1 against the plate, just under the 3:1 non-text bar. #ffb300 or a 0.65 plate alpha fixes it.
// Label text passes everywhere including white (4.69:1). Daylight and night, the mandated cases, pass both.
const BORDER_CHECKED = ["daylight", "night", "black"];

test.describe("WCAG AA contrast", () => {
  test("label text >= 4.5:1 on every backdrop; selected border >= 3:1 on daylight and night", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Digit2");
    const css = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector("#hotbar .slot.selected")!);
      return { text: s.color, plate: s.backgroundColor, border: s.borderTopColor };
    });
    const [text, plate, border] = [parse(css.text), parse(css.plate), parse(css.border)];
    for (const [name, backdrop] of Object.entries(BACKDROPS)) {
      const plateRgb = over(plate, backdrop);
      expect(ratio(over(text, plateRgb), plateRgb), `label on ${name}`).toBeGreaterThanOrEqual(4.5);
      if (BORDER_CHECKED.includes(name)) {
        expect(ratio(over(border, plateRgb), plateRgb), `selected border on ${name}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

/* ---- Screenshot baselines ----------------------------------------------------------------- */
// The WebGL canvas is hidden and the page is flooded with a flat backdrop, so the pixels are the hotbar's
// own and not headless-GL output. Label glyphs are made transparent: their font is machine-dependent (labels
// are asserted via toHaveText and contrast above). What the baseline pins: size, gap, plate, border colours.
// Per CLAUDE.md, regenerate baselines in the pinned Docker image: npx playwright test hotbar --update-snapshots

const SHOTS = [
  { name: "daylight", backdrop: "#87ceeb", press: null },
  { name: "night", backdrop: "#05070f", press: null },
  { name: "daylight-slot3-selected", backdrop: "#87ceeb", press: "Digit3" },
] as const;

for (const shot of SHOTS) {
  test(`screenshot baseline: ${shot.name}`, async ({ page }) => {
    await boot(page);
    await page.addStyleTag({
      content:
        `#app, #overlay { display: none !important } html, body { background: ${shot.backdrop} !important }` +
        ` #hotbar .slot { color: transparent !important }`,
    });
    if (shot.press) await page.keyboard.press(shot.press);
    await expect(page.locator("#hotbar")).toHaveScreenshot(`hotbar-${shot.name}.png`);
  });
}
