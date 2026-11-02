// Day L4-2: biomes. Written BEFORE src/gen/biomes.ts exists (TDD): this file must fail on
// import until biomeAt / biomeWeightsAt / columnAt land.
//
// Covers PRD-L4 US-L4-01 (deterministic biomes), US-L4-02 (no cliff at biome borders),
// US-L4-04 (mountains taller than plains), the snow cap, and the surface-material table.
// US-L4-03 (trees) lives in tests/unit/trees.test.ts.
//
// Every random draw here goes through src/core/rng.ts (seeded). No Math.random.

import { describe, test, expect } from "vitest";
import { createNoise2D } from "simplex-noise";
import { BIOMES } from "../../design/config";
import { cyrb128, rngFromSeed, splitmix32 } from "../../src/core/rng";
import {
  BIOME,
  SURFACE_Y_MAX,
  SURFACE_Y_MIN,
  biomeAt,
  biomeWeightsAt,
  columnAt,
} from "../../src/gen/biomes";
import { surfaceHeightAt, terrainAt } from "../../src/gen/terrain";
import { BLOCKS } from "../../src/world/blocks";
import { DEV_SEED, E2E_SEED, DEMO_SEED } from "../../src/debug/seeds";

const SEEDS = [E2E_SEED, DEV_SEED, DEMO_SEED] as const;
const S = 16;

// ---------------------------------------------------------------------------------------
// Independent reference for the ADR-0013 band picker. It uses only simplex-noise + rng.ts,
// not src/gen/biomes.ts, so it pins the two things that define a world's biome map forever:
//   1. the weight field is createNoise2D(splitmix32(cyrb128(seed)[1])) sampled at
//      (x, z) * WEIGHT_NOISE_SCALE (its own stream; the L3 noise tables are untouched), and
//   2. the bands are w < -0.33 plains, w < 0.33 forest, else mountains.
// Changing either is a world-identity break (like changing the golden hashes).
// ---------------------------------------------------------------------------------------
function referenceBiomeFn(seed: string): (x: number, z: number) => number {
  const noise = createNoise2D(splitmix32(cyrb128(seed)[1]));
  return (x, z) => {
    const w = noise(x * BIOMES.WEIGHT_NOISE_SCALE, z * BIOMES.WEIGHT_NOISE_SCALE);
    return w < -0.33 ? 0 : w < 0.33 ? 1 : 2;
  };
}

function randomCoords(label: string, n: number, span: number): Array<[number, number]> {
  const rng = rngFromSeed(`biomes.test/${label}`);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    out.push([Math.floor((rng() * 2 - 1) * span), Math.floor((rng() * 2 - 1) * span)]);
  }
  return out;
}

/** Height + biome grid over [-half, half)^2. */
function scanRegion(seed: string, half: number) {
  const n = half * 2;
  const h = new Int32Array(n * n);
  const b = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = columnAt(seed, i - half, j - half);
      h[i + j * n] = c.height;
      b[i + j * n] = c.biome;
    }
  }
  return { n, h, b };
}

/** Every 8-neighbour pair once (E, S, SE, SW forward set). */
const FORWARD_8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [1, 1], [-1, 1],
];

// =======================================================================================
describe("biomes: contract and config", () => {
  test("BIOME ids are the documented 0/1/2", () => {
    expect(BIOME.PLAINS).toBe(0);
    expect(BIOME.FOREST).toBe(1);
    expect(BIOME.MOUNTAINS).toBe(2);
  });

  test("locked config values this module is tuned against", () => {
    // If Jon re-tunes any of these the biome tests below are expected to need a re-look;
    // this test turns a silent drift into a loud, readable failure.
    expect(BIOMES.WEIGHT_NOISE_SCALE).toBe(1 / 256);
    expect(BIOMES.TRANSITION_SOFTNESS_BLOCKS).toBe(12);
    expect(BIOMES.MOUNTAIN_HEIGHT_MULT).toBe(2.4);
    expect(BIOMES.PLAINS_ROUGHNESS).toBe(0.35);
    expect(BIOMES.SNOW_CAP_Y).toBe(72);
  });

  test("non-integer world coords are rejected, like surfaceHeightAt", () => {
    expect(() => biomeAt(E2E_SEED, 0.5, 0)).toThrow(RangeError);
    expect(() => biomeAt(E2E_SEED, 0, NaN)).toThrow(RangeError);
    expect(() => columnAt(E2E_SEED, Infinity, 0)).toThrow(RangeError);
    expect(() => biomeWeightsAt(E2E_SEED, 0, 0.25)).toThrow(RangeError);
  });
});

// =======================================================================================
describe("US-L4-01: biomeAt is deterministic from seed + (x, z)", () => {
  test("10,000 random coords: same call twice gives the same biome, and always 0/1/2", () => {
    for (const seed of SEEDS) {
      const coords = randomCoords(`det/${seed}`, 10_000, 100_000);
      const first = coords.map(([x, z]) => biomeAt(seed, x, z));
      const second = coords.map(([x, z]) => biomeAt(seed, x, z));
      expect(second).toEqual(first);
      for (const v of first) expect(v === 0 || v === 1 || v === 2).toBe(true);
    }
  });

  test("matches an independent reference (simplex + rng.ts + the two thresholds) on 10,000 coords", () => {
    for (const seed of SEEDS) {
      const ref = referenceBiomeFn(seed);
      for (const [x, z] of randomCoords(`ref/${seed}`, 10_000, 100_000)) {
        expect(biomeAt(seed, x, z)).toBe(ref(x, z));
      }
    }
  });

  test("no hidden state: result survives evicting every per-seed cache between calls", () => {
    const coords = randomCoords("churn", 2_000, 50_000);
    const before = coords.map(([x, z]) => biomeAt(E2E_SEED, x, z));
    // More distinct seeds than any sane cache bound; then ask again.
    for (let i = 0; i < 12; i++) biomeAt(`churn-seed-${i}`, i * 7, -i * 11);
    const after = coords.map(([x, z]) => biomeAt(E2E_SEED, x, z));
    expect(after).toEqual(before);
  });

  test("golden coordinates are locked (E2E_SEED and DEV_SEED)", () => {
    const pts: Array<[number, number]> = [
      [0, 0], [1, 0], [100, -100], [-250, 250], [515, 509], [-1000, 40],
      [777, -3333], [-5000, 3000], [12345, -6789], [-65531, 65537], [300, -300], [-180, -90],
    ];
    expect(pts.map(([x, z]) => biomeAt(E2E_SEED, x, z))).toEqual([1, 1, 0, 1, 1, 2, 1, 2, 2, 1, 1, 2]);
    expect(pts.map(([x, z]) => biomeAt(DEV_SEED, x, z))).toEqual([1, 1, 2, 1, 1, 2, 2, 1, 1, 1, 2, 2]);
  });

  test("the origin is forest for every seed (noise is exactly 0 at the origin), so spawn is wooded", () => {
    for (const seed of [...SEEDS, "", "x", "another seed"]) {
      expect(biomeAt(seed, 0, 0)).toBe(BIOME.FOREST);
    }
  });

  test("different seeds give different biome maps", () => {
    const coords = randomCoords("seeddiff", 2_000, 50_000);
    const a = coords.map(([x, z]) => biomeAt(E2E_SEED, x, z));
    const b = coords.map(([x, z]) => biomeAt(DEV_SEED, x, z));
    const c = coords.map(([x, z]) => biomeAt(DEMO_SEED, x, z));
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(b).not.toEqual(c);
  });

  test("all three biomes occur with shares within +/-5% of the long-run shares", () => {
    // The +/-0.33 bands on a simplex field are not thirds: measured over a 4096x4096 grid on
    // three seeds the shares are plains ~0.28, forest ~0.44, mountains ~0.28.
    const expected = [0.28, 0.44, 0.28];
    for (const seed of SEEDS) {
      const counts = [0, 0, 0];
      const coords = randomCoords(`share/${seed}`, 10_000, 100_000);
      for (const [x, z] of coords) counts[biomeAt(seed, x, z)]!++;
      for (let i = 0; i < 3; i++) {
        const share = counts[i]! / coords.length;
        expect(Math.abs(share - expected[i]!), `${seed} biome ${i} share ${share}`).toBeLessThan(0.05);
      }
    }
  });
});

// =======================================================================================
describe("ADR-0013: soft blend weights", () => {
  test("weights are in [0,1], sum to 1, and their argmax is biomeAt (5,000 coords x 3 seeds)", () => {
    for (const seed of SEEDS) {
      for (const [x, z] of randomCoords(`w/${seed}`, 5_000, 20_000)) {
        const w = biomeWeightsAt(seed, x, z);
        const arr = [w.plains, w.forest, w.mountains];
        for (const v of arr) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(arr[0]! + arr[1]! + arr[2]! - 1)).toBeLessThan(1e-12);
        const argmax = arr.indexOf(Math.max(...arr));
        expect(argmax, `${seed} (${x},${z}) ${JSON.stringify(w)}`).toBe(biomeAt(seed, x, z));
      }
    }
  });

  test("interiors are pure (one weight exactly 1) and border cells are genuinely mixed", () => {
    let pure = 0;
    let mixed = 0;
    const coords = randomCoords("band", 20_000, 20_000);
    for (const [x, z] of coords) {
      const w = biomeWeightsAt(E2E_SEED, x, z);
      const top = Math.max(w.plains, w.forest, w.mountains);
      if (top === 1) pure++;
      else if (top < 0.9) mixed++;
    }
    // Most of the world is deep inside a biome; a minority is in a blend band.
    expect(pure / coords.length).toBeGreaterThan(0.5);
    expect(mixed / coords.length).toBeGreaterThan(0.01);
    expect(mixed / coords.length).toBeLessThan(0.3);
  });

  test("at a border flip the two meeting biomes weigh ~0.5 each (band is centred on the threshold)", () => {
    // Find a plains|forest or forest|mountains border along a line, then check that exactly at
    // the flip the two weights are both near 0.5 (the band is centred on the threshold).
    const ref = referenceBiomeFn(E2E_SEED);
    let found = 0;
    for (let x = -3000; x < 3000 && found < 5; x++) {
      const z = 17;
      if (ref(x, z) !== ref(x + 1, z)) {
        found++;
        const a = biomeWeightsAt(E2E_SEED, x, z);
        const lo = ref(x, z) === 0 || ref(x + 1, z) === 0 ? "plains" : "mountains";
        const hi = "forest";
        expect(a[hi]).toBeGreaterThan(0.3);
        expect(a[hi]).toBeLessThan(0.7);
        expect(a[lo]).toBeGreaterThan(0.3);
        expect(a[lo]).toBeLessThan(0.7);
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  });
});

// =======================================================================================
describe("US-L4-02: biome borders have no cliff (<= 2 m between 8-neighbours)", () => {
  // PRD-L4 US-L4-02: across >= 1000 pairs of 8-neighbour cells that straddle a biome border,
  // |h1 - h2| <= 2. Region = 512x512 = sixteen 128x128 samples. Interior relief keeps the L3
  // hill steepness by design (L3 alone has a few % of steps > 2); the blend, not the hills,
  // is what must not introduce a wall.
  test.each(SEEDS)("seed %s: every border pair in a 512x512 region is within 2 m", (seed) => {
    const { n, h, b } = scanRegion(seed, 256);
    let pairs = 0;
    let worst = 0;
    const offenders: string[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        for (const [dx, dz] of FORWARD_8) {
          const i2 = i + dx;
          const j2 = j + dz;
          if (i2 < 0 || i2 >= n || j2 >= n) continue;
          if (b[i + j * n] === b[i2 + j2 * n]) continue;
          pairs++;
          const d = Math.abs(h[i + j * n]! - h[i2 + j2 * n]!);
          worst = Math.max(worst, d);
          if (d > 2 && offenders.length < 5) {
            offenders.push(`(${i - 256},${j - 256})->(${i2 - 256},${j2 - 256}) d=${d}`);
          }
        }
      }
    }
    expect(pairs, "enough border pairs to be a meaningful sample").toBeGreaterThanOrEqual(1000);
    expect(offenders, `worst ${worst}`).toEqual([]);
    expect(worst).toBeLessThanOrEqual(2);
  });

  test("no 8-neighbour step anywhere in the region is a spike (sanity cap, L3 alone reaches 5)", () => {
    const { n, h } = scanRegion(E2E_SEED, 128);
    let worst = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        for (const [dx, dz] of FORWARD_8) {
          const i2 = i + dx;
          const j2 = j + dz;
          if (i2 < 0 || i2 >= n || j2 >= n) continue;
          worst = Math.max(worst, Math.abs(h[i + j * n]! - h[i2 + j2 * n]!));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(8);
  });
});

// =======================================================================================
describe("US-L4-04: mountains are taller than plains", () => {
  function meanHeight(seed: string, biome: number, count: number): number {
    const rng = rngFromSeed(`mean/${seed}/${biome}`);
    let sum = 0;
    let got = 0;
    for (let tries = 0; got < count; tries++) {
      expect(tries, "could not find enough cells of this biome").toBeLessThan(count * 50);
      const x = Math.floor((rng() * 2 - 1) * 20_000);
      const z = Math.floor((rng() * 2 - 1) * 20_000);
      if (biomeAt(seed, x, z) !== biome) continue;
      sum += surfaceHeightAt(seed, x, z);
      got++;
    }
    return sum / count;
  }

  test.each(SEEDS)("seed %s: mean of 1,000 MOUNTAINS cells > mean of 1,000 PLAINS cells + 20 m", (seed) => {
    const mountains = meanHeight(seed, BIOME.MOUNTAINS, 1_000);
    const plains = meanHeight(seed, BIOME.PLAINS, 1_000);
    expect(mountains).toBeGreaterThan(plains + 20);
  });

  test("plains are flatter than forest (PLAINS_ROUGHNESS < 1)", () => {
    const sd = (biome: number): number => {
      const rng = rngFromSeed(`sd/${biome}`);
      const hs: number[] = [];
      while (hs.length < 1_000) {
        const x = Math.floor((rng() * 2 - 1) * 20_000);
        const z = Math.floor((rng() * 2 - 1) * 20_000);
        if (biomeAt(E2E_SEED, x, z) === biome) hs.push(surfaceHeightAt(E2E_SEED, x, z));
      }
      const mean = hs.reduce((a, v) => a + v, 0) / hs.length;
      return Math.sqrt(hs.reduce((a, v) => a + (v - mean) ** 2, 0) / hs.length);
    };
    expect(sd(BIOME.PLAINS)).toBeLessThan(sd(BIOME.FOREST) * 0.6);
  });

  test("surface heights are integers inside the published bounds, for every biome", () => {
    for (const seed of SEEDS) {
      for (const [x, z] of randomCoords(`bounds/${seed}`, 5_000, 30_000)) {
        const h = surfaceHeightAt(seed, x, z);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(SURFACE_Y_MIN);
        expect(h).toBeLessThanOrEqual(SURFACE_Y_MAX);
      }
    }
  });

  test("surfaceHeightAt is exactly columnAt(...).height", () => {
    for (const [x, z] of randomCoords("consistency", 2_000, 30_000)) {
      expect(surfaceHeightAt(E2E_SEED, x, z)).toBe(columnAt(E2E_SEED, x, z).height);
    }
  });
});

// =======================================================================================
describe("surface-material table and snow cap", () => {
  const snow = BLOCKS.snow;

  test("plains/forest: grass over dirt; mountains: stone over stone; > SNOW_CAP_Y: snow on top", () => {
    let sawSnow = 0;
    let sawGrassTop = 0;
    let sawStoneTop = 0;
    for (const seed of SEEDS) {
      for (const [x, z] of randomCoords(`mat/${seed}`, 6_000, 30_000)) {
        const c = columnAt(seed, x, z);
        const rock = c.biome === BIOME.MOUNTAINS;
        expect(c.subsurface, `${seed} (${x},${z}) subsurface`).toBe(rock ? BLOCKS.stone : BLOCKS.dirt);
        if (c.height > BIOMES.SNOW_CAP_Y) {
          expect(c.surface, `${seed} (${x},${z}) h=${c.height}`).toBe(snow);
          sawSnow++;
        } else {
          expect(c.surface, `${seed} (${x},${z}) h=${c.height}`).toBe(rock ? BLOCKS.stone : BLOCKS.grass);
          if (rock) sawStoneTop++;
          else sawGrassTop++;
        }
      }
    }
    expect(sawSnow).toBeGreaterThan(100); // peaks exist and are capped
    expect(sawGrassTop).toBeGreaterThan(100);
    expect(sawStoneTop).toBeGreaterThan(100);
  });

  test("snow is not mountain-only: the cap applies in any biome", () => {
    // Any column above the cap is snow regardless of biome (checked above); here, just prove
    // the rule keys on height, by finding snowy columns and confirming none sit at/below it.
    for (const [x, z] of randomCoords("snowrule", 8_000, 30_000)) {
      const c = columnAt(E2E_SEED, x, z);
      expect(c.surface === snow).toBe(c.height > BIOMES.SNOW_CAP_Y);
    }
  });
});

// =======================================================================================
describe("terrainAt bytes agree with the column model", () => {
  const cache = new Map<string, Uint8Array>();
  function blockAt(seed: string, wx: number, wy: number, wz: number): number {
    const cx = Math.floor(wx / S);
    const cy = Math.floor(wy / S);
    const cz = Math.floor(wz / S);
    const key = `${seed}/${cx},${cy},${cz}`;
    let chunk = cache.get(key);
    if (!chunk) {
      chunk = terrainAt(seed, cx, cy, cz);
      cache.set(key, chunk);
    }
    return chunk[wx - cx * S + (wz - cz * S) * S + (wy - cy * S) * S * S]!;
  }

  test("surface and three sub-layers match columnAt for one column of each kind", () => {
    const want = new Set<string>(["plains", "forest", "mountains", "snow"]);
    const picks: Array<{ x: number; z: number; tag: string }> = [];
    for (const [x, z] of randomCoords("bytes", 20_000, 5_000)) {
      const c = columnAt(E2E_SEED, x, z);
      const tag =
        c.height > BIOMES.SNOW_CAP_Y ? "snow"
        : c.biome === BIOME.PLAINS ? "plains"
        : c.biome === BIOME.FOREST ? "forest"
        : "mountains";
      if (want.delete(tag)) picks.push({ x, z, tag });
      if (want.size === 0) break;
    }
    expect(want.size, `missing kinds: ${[...want].join(",")}`).toBe(0);

    for (const { x, z, tag } of picks) {
      const c = columnAt(E2E_SEED, x, z);
      expect(blockAt(E2E_SEED, x, c.height, z), `${tag} surface`).toBe(c.surface);
      for (let d = 1; d <= 3; d++) {
        expect(blockAt(E2E_SEED, x, c.height - d, z), `${tag} sub-layer -${d}`).toBe(c.subsurface);
      }
      if (tag !== "forest") {
        // No trees outside forests: the air above a non-forest surface is clear.
        for (let y = c.height + 1; y <= c.height + 8; y++) {
          expect(blockAt(E2E_SEED, x, y, z), `${tag} air at +${y - c.height}`).toBe(BLOCKS.air);
        }
      }
    }
  });
});
