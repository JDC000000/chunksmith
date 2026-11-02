// Day 4 chunk-streaming contract. All tests use a tiny radius so the matrix
// is small enough to assert explicitly. The ChunkManager must:
//   - populate the correct 3D box of chunks around a player world coord
//   - return added/removed deltas on each update()
//   - be idempotent when the player hasn't crossed a chunk boundary
//   - skip meshing all-air chunks (triangleCount === 0)
//   - cull interior faces across chunk boundaries (Day 5a bring-forward)

import { describe, test, expect } from "vitest";
import { WORLD } from "../../design/config";
import { World } from "../../src/world/World";
import { Chunk } from "../../src/world/Chunk";
import { meshChunk } from "../../src/mesh/naiveMesher";
import type { MeshData, ChunkNeighbors } from "../../src/mesh/naiveMesher";
import { BLOCKS } from "../../src/world/blocks";
import { terrainAt } from "../../src/gen/terrain";
import { ChunkManager } from "../../src/world/ChunkManager";
import { toChunkKey } from "../../src/world/types";
import { ChunkPersistence, saveChunk, clearWorld } from "../../src/world/storage";

const SIZE = WORLD.CHUNK_SIZE;

/** Minimal mesh-builder: run the naive mesher and stash the MeshData on chunk.mesh. */
function makeMeshBuilder(stats: { built: number }): (chunk: Chunk, n: ChunkNeighbors) => void {
  return (chunk, n) => {
    const m = meshChunk(chunk, n);
    chunk.mesh = { meshData: m, geometry: { dispose: () => {} } };
    stats.built++;
  };
}

/** Simple disposer: nulls chunk.mesh and calls dispose() if present. Duck-typed. */
function makeDisposer(stats: { disposed: number }): (chunk: Chunk) => void {
  return (chunk) => {
    const m = chunk.mesh as { geometry?: { dispose?: () => void } } | undefined;
    m?.geometry?.dispose?.();
    chunk.mesh = undefined;
    stats.disposed++;
  };
}

/** Reach into chunk.mesh.meshData — a convention our builder sets up. */
function triCountFor(chunk: Chunk | undefined): number {
  const m = chunk?.mesh as { meshData?: MeshData } | undefined;
  return m?.meshData?.triangleCount ?? 0;
}

describe("ChunkManager", () => {
  test("radius 1/1 at origin loads a 3x3x3 cube of 27 chunks (every coord in -1..1)", () => {
    const w = new World("seed");
    const built = { built: 0 };
    const disposed = { disposed: 0 };
    const cm = new ChunkManager(
      w, terrainAt, makeMeshBuilder(built), makeDisposer(disposed), 1, 1,
    );
    const diff = cm.update(0, 0, 0);
    expect(diff.added.length).toBe(27);
    expect(diff.removed.length).toBe(0);
    expect(w.loadedChunkCount()).toBe(27);

    // Every (cx,cy,cz) in [-1..1]^3 should be loaded.
    for (let cx = -1; cx <= 1; cx++) {
      for (let cy = -1; cy <= 1; cy++) {
        for (let cz = -1; cz <= 1; cz++) {
          expect(w.getChunk({ cx, cy, cz }), `missing chunk ${cx},${cy},${cz}`).toBeDefined();
        }
      }
    }
  });

  test("walking one chunk east adds the +x column and removes the -x column (9 each)", () => {
    const w = new World("seed");
    const cm = new ChunkManager(
      w, terrainAt,
      makeMeshBuilder({ built: 0 }),
      makeDisposer({ disposed: 0 }),
      1, 1,
    );
    cm.update(0, 0, 0);
    const diff = cm.update(SIZE, 0, 0); // player is now at chunk (1,0,0)

    expect(diff.added.length).toBe(9);
    expect(diff.removed.length).toBe(9);

    // Expected added: cx=2 column (cy in -1..1, cz in -1..1)
    for (let cy = -1; cy <= 1; cy++) {
      for (let cz = -1; cz <= 1; cz++) {
        expect(diff.added).toContain(toChunkKey({ cx: 2, cy, cz }));
        expect(diff.removed).toContain(toChunkKey({ cx: -1, cy, cz }));
      }
    }
    expect(w.loadedChunkCount()).toBe(27);
  });

  test("idempotence: calling update() twice at the same position returns empty deltas", () => {
    const w = new World("seed");
    const built = { built: 0 };
    const cm = new ChunkManager(
      w, terrainAt, makeMeshBuilder(built), makeDisposer({ disposed: 0 }), 1, 1,
    );
    cm.update(0, 0, 0);
    const builtOnce = built.built;
    const diff = cm.update(0, 0, 0);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(built.built).toBe(builtOnce); // no extra meshing
  });

  test("an all-air chunk gets an empty mesh (triangleCount === 0)", () => {
    const w = new World("seed");
    const cm = new ChunkManager(
      w, terrainAt,
      makeMeshBuilder({ built: 0 }),
      makeDisposer({ disposed: 0 }),
      0, 0,
    );
    // Pick a sky chunk safely above the procedural heightmap. Terrain tops out
    // around world y ≈ 74, so cy=5 (world y 80..95) is reliably all air for the
    // "seed" seed. (This test was superflat-era pinned to cy=1 — moved up when
    // L3 terrain-generator replaced the flat plane.)
    cm.update(0, SIZE * 5, 0);
    const sky = w.getChunk({ cx: 0, cy: 5, cz: 0 });
    expect(sky).toBeDefined();
    expect(triCountFor(sky)).toBe(0);
  });

  test("neighbor-aware meshing culls the shared face between two solid chunks", () => {
    // Terrain function that returns fully solid grass. Lets us assert exact tri counts.
    const solidGrass = (): Uint8Array => {
      const buf = new Uint8Array(SIZE * SIZE * SIZE);
      buf.fill(BLOCKS.grass);
      return buf;
    };

    // Baseline: a lone solid chunk with NO neighbors loaded. Radius 0/0 loads
    // only chunk (0,0,0); its outer 6 faces all emit = 6 * 16 * 16 * 2 = 3072.
    const wLone = new World("seed");
    const cmLone = new ChunkManager(
      wLone, solidGrass,
      makeMeshBuilder({ built: 0 }),
      makeDisposer({ disposed: 0 }),
      0, 0,
    );
    cmLone.update(0, 0, 0);
    const lone = wLone.getChunk({ cx: 0, cy: 0, cz: 0 });
    expect(triCountFor(lone)).toBe(3072);

    // Pair: radius 1/0 so {(-1..1, 0, -1..1)} = 9 solid chunks are all loaded
    // at once. Chunk (0,0,0) is interior along x and z (neighbors exist on
    // +x,-x,+z,-z) so those four side faces are culled; only +y and -y
    // outer faces remain. 2 * 16*16*2 = 1024.
    const wPair = new World("seed");
    const built = { built: 0 };
    const cmPair = new ChunkManager(
      wPair, solidGrass, makeMeshBuilder(built), makeDisposer({ disposed: 0 }), 1, 0,
    );
    cmPair.update(0, 0, 0);
    const center = wPair.getChunk({ cx: 0, cy: 0, cz: 0 });
    expect(center).toBeDefined();
    // 2 outer faces (top, bottom): 2 * 256 * 2 = 1024 tris.
    expect(triCountFor(center)).toBe(1024);

    // Corner chunk (1,0,1): has neighbors on -x and -z only, so its +x and +z
    // side faces plus top and bottom emit. 4 * 256 * 2 = 2048 tris.
    const corner = wPair.getChunk({ cx: 1, cy: 0, cz: 1 });
    expect(triCountFor(corner)).toBe(2048);

    // Edge chunk (1,0,0): has neighbors on -x, +z, -z but not +x. 3 side faces
    // culled (-x, +z, -z) + top + bottom = 3 outer side-faces? No: outer side
    // faces are +x (exposed) + top + bottom = 3 exposed. 3 * 256 * 2 = 1536.
    const edge = wPair.getChunk({ cx: 1, cy: 0, cz: 0 });
    expect(triCountFor(edge)).toBe(1536);
  });

  test("playerChunk() returns the chunk coord that owns a world position", () => {
    const w = new World("seed");
    const cm = new ChunkManager(
      w, terrainAt,
      makeMeshBuilder({ built: 0 }),
      makeDisposer({ disposed: 0 }),
      0, 0,
    );
    expect(cm.playerChunk(0, 0, 0)).toEqual({ cx: 0, cy: 0, cz: 0 });
    expect(cm.playerChunk(SIZE, 0, 0)).toEqual({ cx: 1, cy: 0, cz: 0 });
    expect(cm.playerChunk(-1, -1, -1)).toEqual({ cx: -1, cy: -1, cz: -1 });
    expect(cm.playerChunk(31, 0, 0)).toEqual({ cx: 1, cy: 0, cz: 0 });
    expect(cm.playerChunk(32, 0, 0)).toEqual({ cx: 2, cy: 0, cz: 0 });
  });

  test("perf: 27 chunks (radius 1/1) load in <200ms in Node", () => {
    const w = new World("seed");
    const cm = new ChunkManager(
      w, terrainAt,
      makeMeshBuilder({ built: 0 }),
      makeDisposer({ disposed: 0 }),
      1, 1,
    );
    const t0 = performance.now();
    cm.update(0, 0, 0);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(200);
  });

  test("radiusH and radiusV can differ (anisotropic load box)", () => {
    const w = new World("seed");
    const cm = new ChunkManager(
      w, terrainAt,
      makeMeshBuilder({ built: 0 }),
      makeDisposer({ disposed: 0 }),
      2, 0, // 5 wide horizontally, 1 tall
    );
    cm.update(0, 0, 0);
    // Expected: cx in [-2..2], cy = 0 only, cz in [-2..2] = 5 * 1 * 5 = 25
    expect(w.loadedChunkCount()).toBe(25);
    // Spot-check: a chunk at cy = 1 should NOT be loaded.
    expect(w.getChunk({ cx: 0, cy: 1, cz: 0 })).toBeUndefined();
    expect(w.getChunk({ cx: 0, cy: -1, cz: 0 })).toBeUndefined();
    // The far horizontal corners ARE loaded.
    expect(w.getChunk({ cx: 2, cy: 0, cz: 2 })).toBeDefined();
    expect(w.getChunk({ cx: -2, cy: 0, cz: -2 })).toBeDefined();
  });

  test("primeChunk falls back to terrainFn when IDB has no saved delta", async () => {
    const worldId = `cm-no-delta-${Date.now()}`;
    try {
      const w = new World("seed");
      let terrainCalls = 0;
      const terrainFn = (seed: string, cx: number, cy: number, cz: number): Uint8Array => {
        terrainCalls++;
        // Return a distinctive byte so we can tell the terrain path ran.
        const buf = new Uint8Array(SIZE * SIZE * SIZE);
        buf.fill(99);
        buf[0] = cx + cy + cz; // dummy to use args
        if (seed === "") buf[1] = 1;
        return buf;
      };
      const persistence = new ChunkPersistence(worldId);
      const cm = new ChunkManager(
        w, terrainFn,
        makeMeshBuilder({ built: 0 }),
        makeDisposer({ disposed: 0 }),
        0, 0,
        persistence,
      );
      await cm.primeChunk({ cx: 7, cy: 0, cz: 0 });
      const chunk = w.getChunk({ cx: 7, cy: 0, cz: 0 });
      expect(chunk).toBeDefined();
      expect(chunk!.voxels[100]).toBe(99); // from terrainFn
      expect(terrainCalls).toBe(1);
    } finally {
      await clearWorld(worldId);
    }
  });

  test("primeChunk loads saved bytes from IDB when present, bypassing terrainFn", async () => {
    const worldId = `cm-with-delta-${Date.now()}`;
    try {
      const w = new World("seed");

      // Pre-seed IDB with a chunk whose voxels we recognize.
      const edited = new Chunk({ cx: 3, cy: 0, cz: 0 });
      edited.voxels.fill(BLOCKS.stone);
      edited.voxels[0] = BLOCKS.grass;
      await saveChunk(worldId, edited);

      let terrainCalls = 0;
      const terrainFn = (): Uint8Array => {
        terrainCalls++;
        return new Uint8Array(SIZE * SIZE * SIZE); // all-air
      };
      const persistence = new ChunkPersistence(worldId);
      const cm = new ChunkManager(
        w, terrainFn,
        makeMeshBuilder({ built: 0 }),
        makeDisposer({ disposed: 0 }),
        0, 0,
        persistence,
      );
      await cm.primeChunk({ cx: 3, cy: 0, cz: 0 });
      const chunk = w.getChunk({ cx: 3, cy: 0, cz: 0 });
      expect(chunk).toBeDefined();
      expect(chunk!.voxels[0]).toBe(BLOCKS.grass);
      expect(chunk!.voxels[100]).toBe(BLOCKS.stone);
      expect(terrainCalls).toBe(0); // IDB hit short-circuited terrainFn
    } finally {
      await clearWorld(worldId);
    }
  });

  test("pre-primed chunks that lack a mesh are meshed by update() (L3 persistence integration)", async () => {
    // L3 integration bug: streamUpdateAsync pre-primes chunks via primeChunk() which
    // populates world.getChunk(coord), then calls update() to attach meshes. Without
    // the needs-meshing branch in update(), those pre-primed chunks are treated as
    // "already current" and never passed to the mesh builder — 27 chunks loaded, 0
    // triangles. This test fails before the fix in ChunkManager.update() that adds
    // desired-but-unmeshed chunks to the remesh set.
    const worldId = "cm-test-prime-remesh";
    try {
      await clearWorld(worldId);
      const w = new World("seed");
      const built = { built: 0 };
      const disposed = { disposed: 0 };
      const persistence = new ChunkPersistence(worldId, 5000);
      const cm = new ChunkManager(
        w, terrainAt, makeMeshBuilder(built), makeDisposer(disposed), 1, 1, persistence,
      );
      // Pre-prime every chunk in the 3x3x3 box around origin — mimics main.ts
      // streamUpdateAsync flow. After this, world has 27 chunks but none have meshes.
      for (let cy = -1; cy <= 1; cy++) {
        for (let cz = -1; cz <= 1; cz++) {
          for (let cx = -1; cx <= 1; cx++) {
            await cm.primeChunk({ cx, cy, cz });
          }
        }
      }
      expect(w.loadedChunkCount()).toBe(27);
      // Any chunk picked at random should have no mesh yet.
      expect(w.getChunk({ cx: 0, cy: 0, cz: 0 })?.mesh).toBeUndefined();
      // Now run update(). Without the fix, `added` is empty and `built` stays 0.
      const diff = cm.update(0, 0, 0);
      expect(diff.added.length).toBe(0); // nothing new to load — all pre-primed
      expect(built.built).toBeGreaterThan(0); // meshes MUST have been built
      // Every solid chunk now has a mesh (air chunks keep the empty-mesh sentinel).
      expect(w.getChunk({ cx: 0, cy: 0, cz: 0 })?.mesh).toBeDefined();
    } finally {
      await clearWorld(worldId);
    }
  });

  test("removed chunks are disposed and dropped from the World", () => {
    const w = new World("seed");
    const built = { built: 0 };
    const disposed = { disposed: 0 };
    const cm = new ChunkManager(
      w, terrainAt, makeMeshBuilder(built), makeDisposer(disposed), 1, 1,
    );
    cm.update(0, 0, 0);
    const beforeDispose = disposed.disposed;
    cm.update(SIZE, 0, 0);
    expect(disposed.disposed - beforeDispose).toBe(9); // the -x column
    // The removed chunks are no longer in the World.
    for (let cy = -1; cy <= 1; cy++) {
      for (let cz = -1; cz <= 1; cz++) {
        expect(w.getChunk({ cx: -1, cy, cz })).toBeUndefined();
      }
    }
  });
});
