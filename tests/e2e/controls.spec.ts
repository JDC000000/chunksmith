import { test, expect, type Page } from "@playwright/test";

/**
 * US-L1-03: WASD moves the camera.
 *
 * Headless Chromium does not reliably acquire pointer-lock, and the main loop
 * only applies WASD while `controls.isLocked`. So we test the two halves
 * separately and deterministically:
 *   1. The controls API is wired to the camera (moveForward / moveRight deltas).
 *   2. The isLocked gate holds: key events alone do NOT move an unlocked camera.
 * The tick-loop -> moveForward path is covered by the manual playtest checklist.
 */

const MOVE_DISTANCE = 5; // PLAYER.MOVE_SPEED_MPS (5) * 1 s
const EPSILON = 0.1;

type Snapshot = { x: number; y: number; z: number; origin: number; frames: number };

async function boot(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => (window as any).__game !== undefined, undefined, { timeout: 5000 });
  // Fixed pose: yaw 0, so "forward" is -z whatever spawn pose main.ts picks.
  await page.evaluate(() => {
    const { camera } = (window as any).__game;
    camera.rotation.set(0, 0, 0);
    camera.updateMatrix(); // moveForward/moveRight read camera.matrix, stale until next render
  });
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const g = (window as any).__game;
    const { x, y, z } = g.camera.position;
    // origin changes if Vite HMR reloads the page mid-test; frames counts renders.
    return { x, y, z, origin: performance.timeOrigin, frames: g.renderer.info.render.frame as number };
  });

test.describe("US-L1-03 WASD moves camera", () => {
  test("moveForward(5) moves camera -5 on z (forward is -z)", async ({ page }) => {
    await boot(page);
    const before = await snapshot(page);

    await page.evaluate((d) => (window as any).__game.controls.moveForward(d), MOVE_DISTANCE);
    const after = await snapshot(page);

    expect(after.origin, "page reloaded mid-test").toBe(before.origin);
    expect(Math.abs(after.z - before.z + MOVE_DISTANCE)).toBeLessThan(EPSILON);
    expect(Math.abs(after.x - before.x)).toBeLessThan(EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON); // xz plane only
  });

  test("moveRight(5) moves camera +5 on x", async ({ page }) => {
    await boot(page);
    const before = await snapshot(page);

    await page.evaluate((d) => (window as any).__game.controls.moveRight(d), MOVE_DISTANCE);
    const after = await snapshot(page);

    expect(after.origin, "page reloaded mid-test").toBe(before.origin);
    expect(Math.abs(after.x - before.x - MOVE_DISTANCE)).toBeLessThan(EPSILON);
    expect(Math.abs(after.z - before.z)).toBeLessThan(EPSILON);
    expect(Math.abs(after.y - before.y)).toBeLessThan(EPSILON);
  });

  test("KeyW held while controls are NOT locked does not move camera", async ({ page }) => {
    await boot(page);

    // Precondition for the gate under test: no pointer lock in a fresh page.
    expect(await page.evaluate(() => (window as any).__game.controls.isLocked)).toBe(false);
    const before = await snapshot(page);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" })));
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" })));

    const after = await snapshot(page);
    expect(after.origin, "page reloaded mid-test; result would be vacuous").toBe(before.origin);
    // Non-vacuous: the main loop really ran with the key held (rules out a dead loop).
    expect(after.frames - before.frames).toBeGreaterThan(10);
    expect([after.x, after.y, after.z]).toEqual([before.x, before.y, before.z]);
  });
});
