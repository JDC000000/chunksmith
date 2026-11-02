// Pure day/night cycle math. No three.js, no globals — the caller supplies
// `nowSec` (performance.now() / 1000 or similar) so this module is testable
// without mocking the clock.
//
// Convention:
//  - timeOfDay in [0,1): 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
//  - sunDirection is normalized world-space. +X = east at sunrise, +Y = up.
//  - A gentle +Z tilt keeps shadows oblique instead of straight-down at noon.

export const DAY_NIGHT_PERIOD_SEC = 600; // 10 minutes per full day/night cycle

/** Day-sky baseline (R,G,B in 0..1). Standard daytime horizon-ish blue. */
const DAY_SKY: [number, number, number] = [0.53, 0.81, 0.92];
/** Night-sky baseline. Dark navy — enough contrast against torchlight at L4+. */
const NIGHT_SKY: [number, number, number] = [0.05, 0.07, 0.16];

/** Below-horizon floor for sunY so twilight still tints the sky. */
const SUN_Y_FLOOR = 0.05;
/** Fixed south-tilt in the sun direction, pre-normalization. */
const SUN_Z_TILT = 0.3;

export interface DayNightState {
  /** [0,1); 0 = midnight. */
  timeOfDay: number;
  /** Unit-length world-space direction FROM origin TOWARD the sun. */
  sunDirection: { x: number; y: number; z: number };
  /** Ambient coefficient fed to the chunk shader. 0.35 at night, up to 0.6 at noon. */
  ambientIntensity: number;
  /** Direct sun contribution. 0 at night, 1 at noon. */
  sunIntensity: number;
  /** Sky clear-color in linear 0..1 RGB. */
  skyColor: { r: number; g: number; b: number };
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute day/night state at `nowSec`, given the start of the cycle at `startSec`.
 * Deterministic: same inputs produce identical output. No `Date.now()` reads.
 */
export function stepDayNight(nowSec: number, startSec: number): DayNightState {
  // Modulo in a way that keeps timeOfDay in [0,1) even if elapsed is negative
  // (callers can wind the clock back in tests).
  const elapsed = (nowSec - startSec) / DAY_NIGHT_PERIOD_SEC;
  let timeOfDay = elapsed - Math.floor(elapsed);
  // Floating-point rounding at the period boundary can land ever-so-slightly
  // negative; snap it to 0 so the invariant [0,1) holds.
  if (timeOfDay < 0) timeOfDay += 1;
  if (timeOfDay >= 1) timeOfDay -= 1;

  // Angle offset so timeOfDay=0.5 (noon) puts the sun at zenith (sunY=1).
  //   theta = (timeOfDay - 0.25) * 2π
  //   at timeOfDay=0.25: theta=0, cos=1, sin=0 → sunrise east, sunY=0
  //   at timeOfDay=0.50: theta=π/2, cos=0, sin=1 → zenith overhead
  //   at timeOfDay=0.75: theta=π, cos=-1, sin=0 → sunset west, sunY=0
  //   at timeOfDay=0.00: theta=-π/2, cos=0, sin=-1 → midnight, sunY floored to 0.05
  const theta = (timeOfDay - 0.25) * Math.PI * 2;
  const rawX = Math.cos(theta);
  const rawY = Math.sin(theta);
  const sunX = rawX;
  const sunY = Math.max(SUN_Y_FLOOR, rawY);
  const sunZ = SUN_Z_TILT;

  const invLen = 1 / Math.hypot(sunX, sunY, sunZ);
  const sunDirection = {
    x: sunX * invLen,
    y: sunY * invLen,
    z: sunZ * invLen,
  };

  // Lighting curves driven by the pre-normalization sun Y (clamped positive)
  // so the twilight floor doesn't accidentally lift the lights above zero at
  // midnight.
  const dayness = clamp(rawY, 0, 1); // 0 all night, ramps up at sunrise, 1 at noon
  const ambientIntensity = 0.35 + 0.25 * dayness;
  const sunIntensity = Math.max(0, rawY);

  // Sky mixes day↔night as `clamp(sunY * 2, 0, 1)` — full day blue by the time
  // the sun is halfway up.
  const skyT = clamp(rawY * 2, 0, 1);
  const skyColor = {
    r: lerp(NIGHT_SKY[0], DAY_SKY[0], skyT),
    g: lerp(NIGHT_SKY[1], DAY_SKY[1], skyT),
    b: lerp(NIGHT_SKY[2], DAY_SKY[2], skyT),
  };

  return {
    timeOfDay,
    sunDirection,
    ambientIntensity,
    sunIntensity,
    skyColor,
  };
}
