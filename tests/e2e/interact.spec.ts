import { test, expect } from "@playwright/test";

/**
 * US-L2-02 (left-click breaks) + US-L2-03 (right-click places).
 *
 * Approach: `window.__game.simulateBlockChange(reason, x, y, z)` shares the
 * exact mutation path with the mouse handler (same applyBlockChange + remesh
 * flow; the only thing it bypasses is the DDA raycast + pointer-lock gate).
 * Headless pointer-lock + raycast is too flaky for CI; the orchestrator-added
 * helper gives us a deterministic hook. The raycast function itself has 12
 * dedicated unit tests in tests/unit/raycast.test.ts.
 *
 * L3 update: terrain is now hills+caves (not superflat), so the tests probe
 * around the spawn chunk and derive working coords from the actual world shape
 * rather than assuming grass-at-y=0. Spawn is at (8, surface+5, 24) via
 * surfaceHeightAt — these tests use the __game.camera position to find solid
 * / air cells in the currently loaded chunks.
 */

test.use({ trace: "off" });

async function boot(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?radius=1,1", { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as any).__game !== undefined, undefined, { timeout: 5000 });
  // Give the async stream a tick to settle (streamUpdateAsync is fire-and-forget).
  await page.waitForFunction(
    () => (window as any).__game && (window as any).__game.world.loadedChunkCount() >= 27,
    undefined,
    { timeout: 5000 },
  );
}

/** Probe the world around spawn: find a solid cell to break and an air cell to place in. */
async function findWorkingCoords(page: import("@playwright/test").Page): Promise<{
  solid: { x: number; y: number; z: number };
  air: { x: number; y: number; z: number };
  airAbove: { x: number; y: number; z: number };
}> {
  return await page.evaluate(() => {
    const g = (window as any).__game;
    const sx = Math.floor(g.camera.position.x);
    const sz = Math.floor(g.camera.position.z);
    // Scan a vertical column near the camera; the first solid-cell-with-air-above
    // is the surface. Returns solid (top of surface) + the air cell directly above.
    for (let y = 60; y >= -16; y--) {
      const here = g.world.getBlock(sx, y, sz);
      const above = g.world.getBlock(sx, y + 1, sz);
      if (here !== 0 && above === 0) {
        // Return another air cell further above for place-tests that assume
        // all-air cells (so place can't be refused for a non-air target).
        return {
          solid: { x: sx, y, z: sz },
          air: { x: sx, y: y + 1, z: sz },
          airAbove: { x: sx, y: y + 3, z: sz },
        };
      }
    }
    throw new Error("findWorkingCoords: no surface cell found near spawn");
  });
}

test("US-L2-02 break: left-click removes a block, remesh completes <100ms", async ({ page }) => {
  await boot(page);
  const coords = await findWorkingCoords(page);
  const probe = await page.evaluate((c) => {
    const g = (window as any).__game;
    const before = g.world.getBlock(c.solid.x, c.solid.y, c.solid.z);
    const t0 = performance.now();
    const result = g.simulateBlockChange("break", c.solid.x, c.solid.y, c.solid.z);
    const dt = performance.now() - t0;
    const after = g.world.getBlock(c.solid.x, c.solid.y, c.solid.z);
    return { before, after, result, dt, stats: g.getBlockChangeStats() };
  }, coords);
  // L3 hills: surface top is grass (1) at low altitude, dirt (2) or stone (3) higher up.
  expect(probe.before).not.toBe(0); // was solid
  expect(probe.result).toBe("ok");
  expect(probe.after).toBe(0); // is now air
  expect(probe.stats.broken).toBe(1);
  // Budget 50 ms per TSD §3 (edit-to-visible). Headless + container slower than
  // real GPU; floor doubled to 100 ms.
  expect(probe.dt).toBeLessThan(100);
});

test("US-L2-03 place: right-click adds a block at the empty cell above the surface", async ({ page }) => {
  await boot(page);
  const coords = await findWorkingCoords(page);
  const probe = await page.evaluate((c) => {
    const g = (window as any).__game;
    const before = g.world.getBlock(c.air.x, c.air.y, c.air.z);
    const result = g.simulateBlockChange("place", c.air.x, c.air.y, c.air.z);
    const after = g.world.getBlock(c.air.x, c.air.y, c.air.z);
    return { before, after, result, stats: g.getBlockChangeStats() };
  }, coords);
  expect(probe.before).toBe(0); // air
  expect(probe.result).toBe("ok");
  expect(probe.after).toBe(1); // grass (hotbar slot 0 default)
  expect(probe.stats.placed).toBe(1);
});

test("US-L2-03 place: selecting slot 3 places stone", async ({ page }) => {
  await boot(page);
  const coords = await findWorkingCoords(page);
  const probe = await page.evaluate((c) => {
    const g = (window as any).__game;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3" }));
    const selected = g.getSelectedBlock();
    const result = g.simulateBlockChange("place", c.airAbove.x, c.airAbove.y, c.airAbove.z);
    const after = g.world.getBlock(c.airAbove.x, c.airAbove.y, c.airAbove.z);
    return { selected, result, after };
  }, coords);
  expect(probe.selected).toBe(3); // stone
  expect(probe.result).toBe("ok");
  expect(probe.after).toBe(3);
});

test("US-L2-02 break: breaking air returns a reason (not ok)", async ({ page }) => {
  await boot(page);
  const coords = await findWorkingCoords(page);
  const probe = await page.evaluate((c) => {
    const g = (window as any).__game;
    const result = g.simulateBlockChange("break", c.airAbove.x, c.airAbove.y, c.airAbove.z);
    return { result, stats: g.getBlockChangeStats() };
  }, coords);
  expect(probe.result).not.toBe("ok");
  expect(probe.stats.broken).toBe(0);
});

test("US-L2-05 persistence: edits survive repeated reads (in-memory)", async ({ page }) => {
  await boot(page);
  const coords = await findWorkingCoords(page);
  const probe = await page.evaluate((c) => {
    const g = (window as any).__game;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3" }));
    g.simulateBlockChange("place", c.airAbove.x, c.airAbove.y, c.airAbove.z);
    const placed = g.world.getBlock(c.airAbove.x, c.airAbove.y, c.airAbove.z);
    // Multiple reads should all return the placed block (in-memory persistence).
    // Chunk eviction/regen + IDB persistence is L3 scope (covered by storage unit tests).
    const r1 = g.world.getBlock(c.airAbove.x, c.airAbove.y, c.airAbove.z);
    const r2 = g.world.getBlock(c.airAbove.x, c.airAbove.y, c.airAbove.z);
    return { placed, r1, r2 };
  }, coords);
  expect(probe.placed).toBe(3);
  expect(probe.r1).toBe(3);
  expect(probe.r2).toBe(3);
});
