// Day L4-2: forest trees (PRD-L4 US-L4-03). Written BEFORE the tree code in
// src/gen/biomes.ts exists (TDD).
//
// Contract under test:
//   - treesInChunk(seed, cx, cz) lists the trees ROOTED in chunk column (cx, cz): a pure
//     function of its arguments (no hidden state, no call-order dependence).
//   - A forest chunk gets BIOMES.FOREST_TREES_PER_CHUNK trees (candidates that land on a
//     non-forest or snowy column are dropped, so border chunks get fewer).
//   - terrainAt stamps trees into the bytes, including canopies that cross chunk seams, and
//     never overwrites terrain.
//
// No random draws are made in this file at all (no Math.random); coordinates are scanned.

import { describe, test, expect } from "vitest";
import { BIOMES } from "../../design/config";
import {
  BIOME,
  SURFACE_Y_MAX,
  SURFACE_Y_MIN,
  TREE_RISE_MAX,
  TREE_TRUNK_MAX,
  TREE_TRUNK_MIN,
  biomeAt,
  columnAt,
  treeBlocks,
  treesInChunk,
} from "../../src/gen/biomes";
import { terrainAt } from "../../src/gen/terrain";
import { BLOCKS } from "../../src/world/blocks";
import { E2E_SEED, DEV_SEED, DEMO_SEED } from "../../src/debug/seeds";

const S = 16;
const N = BIOMES.FOREST_TREES_PER_CHUNK;

/** Chunk columns whose centre column is forest, scanned on a stride so they are not one clump. */
function forestCentreChunks(seed: string, want: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let r = 0; r < 200 && out.length < want; r++) {
    for (let cz = -r; cz <= r && out.length < want; cz += 3) {
      for (let cx = -r; cx <= r && out.length < want; cx += 3) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
        if (biomeAt(seed, cx * S + 8, cz * S + 8) === BIOME.FOREST) out.push([cx + 0, cz + 0]); // + 0: no -0
      }
    }
  }
  return out;
}

/** True when every one of the 256 columns of chunk column (cx, cz) is forest with a grass top. */
function entirelyWoodable(seed: string, cx: number, cz: number): boolean {
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const c = columnAt(seed, cx * S + lx, cz * S + lz);
      if (c.biome !== BIOME.FOREST || c.surface !== BLOCKS.grass) return false;
    }
  }
  return true;
}

/** True when no column of the chunk column could host a tree (non-forest everywhere). */
function entirelyBare(seed: string, cx: number, cz: number): boolean {
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      if (columnAt(seed, cx * S + lx, cz * S + lz).biome === BIOME.FOREST) return false;
    }
  }
  return true;
}

// =======================================================================================
describe("treeBlocks: the tree shape", () => {
  test.each([TREE_TRUNK_MIN, TREE_TRUNK_MAX])("trunk %i: wood column, leafy crown, nothing below the ground", (trunk) => {
    const cells = treeBlocks(trunk);
    const wood = cells.filter((c) => c.block === BLOCKS.wood);
    const leaves = cells.filter((c) => c.block === BLOCKS.leaves);
    expect(wood.length + leaves.length).toBe(cells.length);

    // Trunk: exactly one wood block per level, on the root column, starting right above ground.
    expect(wood.map((c) => [c.dx, c.dz])).toEqual(wood.map(() => [0, 0]));
    expect(wood.map((c) => c.dy).sort((a, b) => a - b)).toEqual(
      Array.from({ length: trunk }, (_, i) => i + 1),
    );

    expect(leaves.length).toBeGreaterThan(20);
    for (const c of cells) {
      expect(c.dy).toBeGreaterThanOrEqual(1);
      expect(c.dy).toBeLessThanOrEqual(TREE_RISE_MAX);
      expect(Math.abs(c.dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.dz)).toBeLessThanOrEqual(2);
    }
    // No two cells share a position (a leaf on the trunk's own cell would hide the log).
    expect(new Set(cells.map((c) => `${c.dx},${c.dy},${c.dz}`)).size).toBe(cells.length);
    // The crown rises above the top log.
    expect(Math.max(...leaves.map((c) => c.dy))).toBeGreaterThan(trunk);
  });

  test("TREE_RISE_MAX is the tallest possible tree", () => {
    const tallest = Math.max(...treeBlocks(TREE_TRUNK_MAX).map((c) => c.dy));
    expect(tallest).toBe(TREE_RISE_MAX);
  });
});

// =======================================================================================
describe("treesInChunk: determinism and placement rules", () => {
  test("pure function of (seed, cx, cz): repeatable, order-free, cache-free", () => {
    const probe: Array<[number, number]> = [[0, 0], [3, -4], [-9, 12], [20, 20], [-31, -2]];
    const first = probe.map(([cx, cz]) => treesInChunk(E2E_SEED, cx, cz));
    // Churn: many other seeds and chunks in between (evicts any bounded per-seed cache).
    for (let i = 0; i < 12; i++) treesInChunk(`churn-${i}`, i, -i);
    const second = [...probe].reverse().map(([cx, cz]) => treesInChunk(E2E_SEED, cx, cz)).reverse();
    expect(second).toEqual(first);
  });

  test("different seeds and neighbouring chunks get different trees", () => {
    const forest = forestCentreChunks(E2E_SEED, 4);
    expect(forest.length).toBe(4);
    const [a, b] = forest as [[number, number], [number, number]];
    expect(treesInChunk(E2E_SEED, a[0], a[1])).not.toEqual(treesInChunk(E2E_SEED, b[0], b[1]));
    let differs = false;
    for (const [cx, cz] of forest) {
      if (JSON.stringify(treesInChunk(E2E_SEED, cx, cz)) !== JSON.stringify(treesInChunk(DEV_SEED, cx, cz))) differs = true;
    }
    expect(differs).toBe(true);
  });

  test("US-L4-03: forest chunks average FOREST_TREES_PER_CHUNK trees, +/- 1, over 100 chunks", () => {
    for (const seed of [E2E_SEED, DEV_SEED, DEMO_SEED]) {
      const chunks = forestCentreChunks(seed, 100);
      expect(chunks.length, `${seed}: found 100 forest chunks`).toBe(100);
      let total = 0;
      for (const [cx, cz] of chunks) total += treesInChunk(seed, cx, cz).length;
      const mean = total / chunks.length;
      expect(mean, `${seed} mean trees per forest chunk`).toBeGreaterThanOrEqual(N - 1);
      expect(mean, `${seed} mean trees per forest chunk`).toBeLessThanOrEqual(N + 1);
    }
  });

  test("a chunk that is forest-with-grass edge to edge gets exactly FOREST_TREES_PER_CHUNK trees", () => {
    let checked = 0;
    for (const [cx, cz] of forestCentreChunks(E2E_SEED, 150)) {
      if (!entirelyWoodable(E2E_SEED, cx, cz)) continue;
      expect(treesInChunk(E2E_SEED, cx, cz).length, `chunk (${cx},${cz})`).toBe(N);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  test("chunks with no forest anywhere in them get no trees", () => {
    let checked = 0;
    for (let cz = -40; cz <= 40 && checked < 60; cz += 2) {
      for (let cx = -40; cx <= 40 && checked < 60; cx += 2) {
        if (!entirelyBare(E2E_SEED, cx, cz)) continue;
        expect(treesInChunk(E2E_SEED, cx, cz), `chunk (${cx},${cz})`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  test("every tree: inside its chunk, rooted on a forest grass column, sane trunk, 3+ apart", () => {
    let trees = 0;
    for (const [cx, cz] of forestCentreChunks(E2E_SEED, 120)) {
      const list = treesInChunk(E2E_SEED, cx, cz);
      for (let i = 0; i < list.length; i++) {
        const t = list[i]!;
        trees++;
        expect(Math.floor(t.x / S)).toBe(cx);
        expect(Math.floor(t.z / S)).toBe(cz);
        const col = columnAt(E2E_SEED, t.x, t.z);
        expect(col.biome).toBe(BIOME.FOREST);
        expect(col.surface).toBe(BLOCKS.grass); // never on snow or rock
        expect(t.baseY).toBe(col.height);
        expect(t.baseY).toBeLessThanOrEqual(BIOMES.SNOW_CAP_Y);
        expect(Number.isInteger(t.trunk)).toBe(true);
        expect(t.trunk).toBeGreaterThanOrEqual(TREE_TRUNK_MIN);
        expect(t.trunk).toBeLessThanOrEqual(TREE_TRUNK_MAX);
        for (let j = i + 1; j < list.length; j++) {
          const u = list[j]!;
          expect(Math.max(Math.abs(t.x - u.x), Math.abs(t.z - u.z))).toBeGreaterThanOrEqual(3);
        }
      }
    }
    expect(trees).toBeGreaterThan(300);
  });

  test("rejects non-integer chunk coords", () => {
    expect(() => treesInChunk(E2E_SEED, 0.5, 0)).toThrow(RangeError);
    expect(() => treesInChunk(E2E_SEED, 0, NaN)).toThrow(RangeError);
  });
});

// =======================================================================================
describe("terrainAt: trees in the generated bytes", () => {
  const cache = new Map<string, Uint8Array>();
  function chunkOf(seed: string, cx: number, cy: number, cz: number): Uint8Array {
    const key = `${seed}/${cx},${cy},${cz}`;
    let c = cache.get(key);
    if (!c) {
      c = terrainAt(seed, cx, cy, cz);
      cache.set(key, c);
    }
    return c;
  }
  function blockAt(seed: string, wx: number, wy: number, wz: number): number {
    const cx = Math.floor(wx / S);
    const cy = Math.floor(wy / S);
    const cz = Math.floor(wz / S);
    return chunkOf(seed, cx, cy, cz)[wx - cx * S + (wz - cz * S) * S + (wy - cy * S) * S * S]!;
  }

  const CY_LO = Math.floor(SURFACE_Y_MIN / S);
  const CY_HI = Math.floor((SURFACE_Y_MAX + TREE_RISE_MAX) / S);

  /** An 8x8-chunk (128x128 block) window that is mostly forest, found by scanning. */
  function forestWindow(seed: string): [number, number] {
    for (let r = 0; r < 40; r++) {
      for (let wz = -r; wz <= r; wz++) {
        for (let wx = -r; wx <= r; wx++) {
          if (Math.max(Math.abs(wx), Math.abs(wz)) !== r) continue;
          const cx0 = wx * 8;
          const cz0 = wz * 8;
          let forest = 0;
          for (let j = 0; j < 8; j++) {
            for (let i = 0; i < 8; i++) {
              if (biomeAt(seed, (cx0 + i) * S + 8, (cz0 + j) * S + 8) === BIOME.FOREST) forest++;
            }
          }
          if (forest >= 56) return [cx0, cz0]; // >= 87% forest-dominant
        }
      }
    }
    throw new Error("no forest-dominant 128x128 window found");
  }

  test("US-L4-03: a forest-dominant 128x128 region at E2E_SEED has >= 20 trees in its bytes", () => {
    const [cx0, cz0] = forestWindow(E2E_SEED);
    // A tree is a log standing directly on grass. Count them in the generated chunks.
    let trunkBases = 0;
    let leafBlocks = 0;
    let expected = 0;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        expected += treesInChunk(E2E_SEED, cx0 + i, cz0 + j).length;
        for (let cy = CY_LO; cy <= CY_HI; cy++) {
          const chunk = chunkOf(E2E_SEED, cx0 + i, cy, cz0 + j);
          for (let k = 0; k < chunk.length; k++) {
            const b = chunk[k]!;
            if (b === BLOCKS.leaves) leafBlocks++;
            if (b !== BLOCKS.wood) continue;
            const lx = k % S;
            const lz = Math.floor(k / S) % S;
            const ly = Math.floor(k / (S * S));
            const wx = (cx0 + i) * S + lx;
            const wz = (cz0 + j) * S + lz;
            const wy = cy * S + ly;
            if (blockAt(E2E_SEED, wx, wy - 1, wz) === BLOCKS.grass) trunkBases++;
          }
        }
      }
    }
    expect(trunkBases).toBeGreaterThanOrEqual(20);
    expect(leafBlocks).toBeGreaterThan(trunkBases * 10);
    // The bytes hold exactly the trees the spec says are rooted in this window: nothing lost
    // at chunk seams, nothing duplicated.
    expect(trunkBases).toBe(expected);
  });

  test("every cell of every tree is in the bytes, canopies included across chunk seams", () => {
    const [cx0, cz0] = forestWindow(E2E_SEED);
    let treesChecked = 0;
    let seamTrees = 0;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        for (const t of treesInChunk(E2E_SEED, cx0 + i, cz0 + j)) {
          treesChecked++;
          const lx = t.x - (cx0 + i) * S;
          const lz = t.z - (cz0 + j) * S;
          if (lx < 2 || lx > S - 3 || lz < 2 || lz > S - 3) seamTrees++;
          for (const c of treeBlocks(t.trunk)) {
            const wx = t.x + c.dx;
            const wz = t.z + c.dz;
            const wy = t.baseY + c.dy;
            const ground = columnAt(E2E_SEED, wx, wz).height;
            if (wy <= ground) continue; // canopy poking into a hillside: terrain wins
            const got = blockAt(E2E_SEED, wx, wy, wz);
            if (c.block === BLOCKS.wood) {
              expect(got, `log at (${wx},${wy},${wz})`).toBe(BLOCKS.wood);
            } else {
              // A leaf cell is leaves, unless a neighbouring tree's log owns the cell.
              expect([BLOCKS.leaves, BLOCKS.wood], `leaf at (${wx},${wy},${wz}) got ${got}`).toContain(got);
            }
          }
        }
      }
    }
    expect(treesChecked).toBeGreaterThanOrEqual(20);
    expect(seamTrees).toBeGreaterThan(0); // the window really exercised chunk seams
  });

  test("trees never replace terrain: below-ground bytes carry no wood or leaves", () => {
    const [cx0, cz0] = forestWindow(E2E_SEED);
    for (let j = 0; j < 4; j++) {
      for (let i = 0; i < 4; i++) {
        for (let cy = CY_LO; cy <= CY_HI; cy++) {
          const chunk = chunkOf(E2E_SEED, cx0 + i, cy, cz0 + j);
          for (let k = 0; k < chunk.length; k++) {
            const b = chunk[k]!;
            if (b !== BLOCKS.wood && b !== BLOCKS.leaves) continue;
            const lx = k % S;
            const lz = Math.floor(k / S) % S;
            const ly = Math.floor(k / (S * S));
            const ground = columnAt(E2E_SEED, (cx0 + i) * S + lx, (cz0 + j) * S + lz).height;
            expect(cy * S + ly).toBeGreaterThan(ground);
          }
        }
      }
    }
  });

  test("a chunk's bytes do not depend on which neighbours were generated first", () => {
    const [cx0, cz0] = forestWindow(E2E_SEED);
    const cx = cx0 + 3;
    const cz = cz0 + 3;
    const cy = Math.floor(columnAt(E2E_SEED, cx * S + 8, cz * S + 8).height / S);
    const cold = terrainAt(E2E_SEED, cx, cy, cz);
    // Touch the whole 3x3x3 neighbourhood and a pile of other seeds, then regenerate.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) terrainAt(E2E_SEED, cx + dx, cy + dy, cz + dz);
      }
    }
    for (let k = 0; k < 8; k++) terrainAt(`order-${k}`, cx, cy, cz);
    const warm = terrainAt(E2E_SEED, cx, cy, cz);
    expect(Array.from(warm)).toEqual(Array.from(cold));
  });

  test("the sky above the tallest possible tree is all air", () => {
    const [cx0, cz0] = forestWindow(E2E_SEED);
    const cy = Math.floor((SURFACE_Y_MAX + TREE_RISE_MAX) / S) + 1;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        expect(terrainAt(E2E_SEED, cx0 + i, cy, cz0 + j).every((v) => v === BLOCKS.air)).toBe(true);
      }
    }
  });

  test("other seeds also grow trees (not an E2E_SEED accident)", () => {
    for (const seed of [DEV_SEED, DEMO_SEED]) {
      const [cx0, cz0] = forestWindow(seed);
      let logs = 0;
      for (let cy = CY_LO; cy <= CY_HI; cy++) {
        const chunk = terrainAt(seed, cx0 + 3, cy, cz0 + 3);
        for (const b of chunk) if (b === BLOCKS.wood) logs++;
      }
      expect(logs, seed).toBeGreaterThan(0);
    }
  });
});
