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
 */

test.use({ trace: "off" });

async function boot(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?radius=1,1", { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as any).__game !== undefined, undefined, { timeout: 5000 });
}

// Spawn is at (8, 20, 48). With ?radius=1,1 the loaded chunks are
// cx ∈ {-1,0,1}, cy ∈ {0,1,2}, cz ∈ {2,3,4} — so grass exists at world y=0 for
// x ∈ [-16, 31], z ∈ [32, 79]. All tests pick coords inside that envelope.

test("US-L2-02 break: left-click removes a block, remesh completes <100ms", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => {
    const g = (window as any).__game;
    const before = g.world.getBlock(8, 0, 48);
    const t0 = performance.now();
    const result = g.simulateBlockChange("break", 8, 0, 48);
    const dt = performance.now() - t0;
    const after = g.world.getBlock(8, 0, 48);
    return { before, after, result, dt, stats: g.getBlockChangeStats() };
  });
  expect(probe.before).toBe(1); // grass
  expect(probe.result).toBe("ok");
  expect(probe.after).toBe(0); // air
  expect(probe.stats.broken).toBe(1);
  // Budget 50 ms per TSD §3 (edit-to-visible). Headless + container slower than
  // real GPU; floor doubled to 100 ms.
  expect(probe.dt).toBeLessThan(100);
});

test("US-L2-03 place: right-click adds a block at the empty cell above the surface", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => {
    const g = (window as any).__game;
    const before = g.world.getBlock(5, 1, 48);  // air above grass
    const result = g.simulateBlockChange("place", 5, 1, 48);
    const after = g.world.getBlock(5, 1, 48);
    return { before, after, result, stats: g.getBlockChangeStats() };
  });
  expect(probe.before).toBe(0); // air
  expect(probe.result).toBe("ok");
  expect(probe.after).toBe(1); // grass (hotbar slot 0 default)
  expect(probe.stats.placed).toBe(1);
});

test("US-L2-03 place: selecting slot 3 places stone", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => {
    const g = (window as any).__game;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3" }));
    const selected = g.getSelectedBlock();
    const result = g.simulateBlockChange("place", 7, 2, 48);
    const after = g.world.getBlock(7, 2, 48);
    return { selected, result, after };
  });
  expect(probe.selected).toBe(3); // stone
  expect(probe.result).toBe("ok");
  expect(probe.after).toBe(3);
});

test("US-L2-02 break: breaking air returns a reason (not ok)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => {
    const g = (window as any).__game;
    // (5, 10, 48) is air (well above the grass surface, inside loaded chunk).
    const result = g.simulateBlockChange("break", 5, 10, 48);
    return { result, stats: g.getBlockChangeStats() };
  });
  expect(probe.result).not.toBe("ok");
  expect(probe.stats.broken).toBe(0);
});

test("US-L2-05 persistence: edits survive repeated reads (in-memory)", async ({ page }) => {
  await boot(page);
  const probe = await page.evaluate(() => {
    const g = (window as any).__game;
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3" }));
    g.simulateBlockChange("place", 3, 2, 48);
    const placed = g.world.getBlock(3, 2, 48);
    // Multiple reads should all return the placed block (in-memory persistence).
    // Chunk eviction/regen + IDB persistence is L3 scope.
    const r1 = g.world.getBlock(3, 2, 48);
    const r2 = g.world.getBlock(3, 2, 48);
    return { placed, r1, r2 };
  });
  expect(probe.placed).toBe(3);
  expect(probe.r1).toBe(3);
  expect(probe.r2).toBe(3);
});
