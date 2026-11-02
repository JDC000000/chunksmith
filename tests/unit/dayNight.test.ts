// Day/night cycle math. Pure module — deterministic, no clock reads.
// All timings are driven by `nowSec - startSec`, so the caller controls the clock.

import { describe, expect, test } from "vitest";
import {
  DAY_NIGHT_PERIOD_SEC,
  stepDayNight,
} from "../../src/render/dayNight";

const EPS = 1e-6;

function approx(a: number, b: number, tol = 1e-4): void {
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

describe("stepDayNight: timeOfDay", () => {
  test("period is 600 seconds (10-minute day)", () => {
    expect(DAY_NIGHT_PERIOD_SEC).toBe(600);
  });

  test("t=0 is midnight (timeOfDay = 0)", () => {
    const s = stepDayNight(0, 0);
    expect(s.timeOfDay).toBe(0);
  });

  test("t=150s is sunrise (timeOfDay = 0.25)", () => {
    const s = stepDayNight(150, 0);
    approx(s.timeOfDay, 0.25);
  });

  test("t=300s is noon (timeOfDay = 0.5)", () => {
    const s = stepDayNight(300, 0);
    approx(s.timeOfDay, 0.5);
  });

  test("t=450s is sunset (timeOfDay = 0.75)", () => {
    const s = stepDayNight(450, 0);
    approx(s.timeOfDay, 0.75);
  });

  test("t=600s wraps back to midnight", () => {
    const s = stepDayNight(600, 0);
    approx(s.timeOfDay, 0);
  });

  test("startSec shifts the cycle: at startSec=100, nowSec=100 is midnight", () => {
    const s = stepDayNight(100, 100);
    expect(s.timeOfDay).toBe(0);
  });
});

describe("stepDayNight: deterministic (no Date.now())", () => {
  test("same inputs produce identical state", () => {
    const a = stepDayNight(123.456, 10);
    const b = stepDayNight(123.456, 10);
    expect(a).toEqual(b);
  });
});

describe("stepDayNight: sun direction", () => {
  test("sunY is at the floor (0.05 pre-normalization) at midnight", () => {
    const s = stepDayNight(0, 0);
    // Pre-normalization vector is (0, 0.05, 0.3) → length ≈ 0.3041, Y ≈ 0.1644.
    approx(s.sunDirection.y, 0.05 / Math.hypot(0, 0.05, 0.3));
  });

  test("sunY is near zenith (~1 pre-normalization) at noon", () => {
    const s = stepDayNight(300, 0);
    // Pre-normalization sin(pi/2) = 1 for Y, cos = 0 for X.
    // After normalization the Y component dominates: norm = sqrt(0 + 1 + 0.09) ≈ 1.044.
    expect(s.sunDirection.y).toBeGreaterThan(0.9);
    expect(Math.abs(s.sunDirection.x)).toBeLessThan(1e-6 + 0.01);
  });

  test("sun direction is unit-length at every sampled time", () => {
    for (const t of [0, 75, 150, 225, 300, 375, 450, 525]) {
      const s = stepDayNight(t, 0);
      const len = Math.hypot(s.sunDirection.x, s.sunDirection.y, s.sunDirection.z);
      expect(Math.abs(len - 1)).toBeLessThan(EPS);
    }
  });

  test("sunX is positive at sunrise and negative at sunset", () => {
    const sr = stepDayNight(150, 0);
    const ss = stepDayNight(450, 0);
    expect(sr.sunDirection.x).toBeGreaterThan(0);
    expect(ss.sunDirection.x).toBeLessThan(0);
  });
});

describe("stepDayNight: ambient curve", () => {
  test("ambient is non-decreasing from midnight to noon (rawY clamp means pre-sunrise is flat)", () => {
    const midnight = stepDayNight(0, 0).ambientIntensity;
    const sunrise = stepDayNight(150, 0).ambientIntensity;
    const mid = stepDayNight(225, 0).ambientIntensity;
    const noon = stepDayNight(300, 0).ambientIntensity;
    expect(midnight).toBeLessThanOrEqual(sunrise);
    expect(sunrise).toBeLessThanOrEqual(mid);
    expect(mid).toBeLessThan(noon);
    expect(midnight).toBeLessThan(noon);
  });

  test("ambient at noon is ~0.6, ambient at midnight is ~0.35 (floor only)", () => {
    const midnight = stepDayNight(0, 0).ambientIntensity;
    const noon = stepDayNight(300, 0).ambientIntensity;
    approx(midnight, 0.35, 0.02);
    approx(noon, 0.6, 0.02);
  });
});

describe("stepDayNight: sun intensity", () => {
  test("sunIntensity is 0 at midnight (sunY floored at 0.05 clamps to day-only range)", () => {
    // The spec says sunIntensity = max(0, sunY) * 1.0 — pre-normalization sunY
    // at midnight is sin(-pi/2) = -1 → max(0, -1) = 0.
    const s = stepDayNight(0, 0);
    expect(s.sunIntensity).toBe(0);
  });

  test("sunIntensity is ~1 at noon", () => {
    const s = stepDayNight(300, 0);
    approx(s.sunIntensity, 1, 1e-4);
  });

  test("sunIntensity is monotonic from midnight to noon", () => {
    let prev = -1;
    for (const t of [0, 75, 150, 225, 300]) {
      const s = stepDayNight(t, 0);
      expect(s.sunIntensity).toBeGreaterThanOrEqual(prev);
      prev = s.sunIntensity;
    }
  });
});

describe("stepDayNight: sky color", () => {
  test("sky color at noon is the day blue (0.53, 0.81, 0.92)", () => {
    const s = stepDayNight(300, 0);
    approx(s.skyColor.r, 0.53, 0.01);
    approx(s.skyColor.g, 0.81, 0.01);
    approx(s.skyColor.b, 0.92, 0.01);
  });

  test("sky color at midnight is the night navy (0.05, 0.07, 0.16)", () => {
    const s = stepDayNight(0, 0);
    approx(s.skyColor.r, 0.05, 0.01);
    approx(s.skyColor.g, 0.07, 0.01);
    approx(s.skyColor.b, 0.16, 0.01);
  });

  test("sky color at noon is brighter than at midnight on all channels", () => {
    const midnight = stepDayNight(0, 0).skyColor;
    const noon = stepDayNight(300, 0).skyColor;
    expect(noon.r).toBeGreaterThan(midnight.r);
    expect(noon.g).toBeGreaterThan(midnight.g);
    expect(noon.b).toBeGreaterThan(midnight.b);
  });
});
