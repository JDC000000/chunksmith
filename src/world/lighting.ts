// Block + sky light propagation.
//
// ADR-0014: incremental dirty-queue BFS. One Uint8Array per chunk, two
// nibbles per cell — skylight in the high nibble, block-light in the low.
// `markBlockChanged` seeds the queue when a voxel is written (place or
// break); `step(budget)` pops cells, propagates to 6-way neighbors, and
// re-enqueues them if their level changed. Darkness propagation (remove
// torch) uses the same queue with a two-pass remove→refill algorithm so
// a shrinking light front doesn't leave stale bright cells behind.
//
// NO three.js. NO Math.random — the shader does its own perlin for flicker.
// This module compiles for Workers (L3+).

import { WORLD, LIGHTING } from "../../design/config";
import type { World } from "./World";
import {
  Chunk,
  CHUNK_SIZE,
  chunkIndex,
  getBlock,
  getBlockLight,
  getSkylight,
  setBlockLight,
  setSkylight,
} from "./Chunk";
import {
  BLOCKS,
  emission,
  isTransparent,
  lightAttenuation,
} from "./blocks";
import type { ChunkCoord } from "./types";

const SIZE = WORLD.CHUNK_SIZE;

/**
 * A pending propagation seed. The lighting system keeps a FIFO queue of
 * (chunk + local coord) pairs; `step()` pops and propagates. A separate
 * Set-dedupe keeps re-marking the same cell cheap.
 */
interface LightSeed {
  chunk: Chunk;
  lx: number;
  ly: number;
  lz: number;
  /** Kind of propagation: "add" (floodfill) or "remove" (de-light). */
  kind: "add" | "remove";
  /** For "remove": the pre-removal block-light we're tearing down. */
  priorLevel?: number;
}

/** Global 6-neighbor offsets. */
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * Seed skylight down a single (x,z) column of a chunk, from the top until the
 * first opaque cell. Air (and any transparent block that doesn't fully block
 * light — e.g. torches/water) continues the column; opaque cells stop it.
 *
 * Below the first opaque cell, skylight stays at 0. The horizontal
 * attenuation into overhangs is handled by `step()` via `markLightCell`.
 */
export function seedSkylightColumn(chunk: Chunk, lx: number, lz: number): void {
  let blocked = false;
  for (let y = SIZE - 1; y >= 0; y--) {
    const id = getBlock(chunk, lx, y, lz);
    if (blocked) {
      setSkylight(chunk, lx, y, lz, 0);
      continue;
    }
    // Fully opaque cell stops the column at this row (and the cell itself gets 0).
    if (!isTransparent(id)) {
      setSkylight(chunk, lx, y, lz, 0);
      blocked = true;
      continue;
    }
    // Transparent (incl. leaves): sunlight reaches this cell. The downstream
    // step() will apply horizontal falloff; vertical falloff through
    // transparent blocks is zero at the column seed so direct sunlight stays
    // at MAX until the first opaque hit.
    setSkylight(chunk, lx, y, lz, LIGHTING.SUNLIGHT_LEVEL_MAX);
  }
}

/**
 * Incremental dirty-queue BFS propagator. One instance per World.
 *
 * Usage from main loop:
 *   const ls = new LightingSystem(world);
 *   // on block change:
 *   ls.markBlockChanged(chunk, lx, ly, lz);
 *   // per frame:
 *   ls.step(LIGHTING.DIRTY_QUEUE_BUDGET_PER_FRAME);
 */
export class LightingSystem {
  private readonly world: World;
  private readonly queue: LightSeed[] = [];
  /** Dedupe set for "add" seeds — "cx,cy,cz:idx" → true. */
  private readonly addDedupe: Set<string> = new Set();

  constructor(world: World) {
    this.world = world;
  }

  /** Current pending seed count — debug HUD + convergence tests. */
  pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Mark the cell's current light bytes as needing re-propagation. Use for
   * sky-seed cascades or when an upstream caller already wrote the right
   * byte but needs the system to push it to neighbors.
   */
  markLightCell(chunk: Chunk, lx: number, ly: number, lz: number): void {
    this.enqueueAdd(chunk, lx, ly, lz);
  }

  /**
   * React to a voxel change at (lx,ly,lz) on `chunk`. The system inspects the
   * new block id and chooses:
   *   - emission > 0 → seed add from the new block-light value
   *   - previously-emitting cell now air → seed remove with priorLevel
   *   - transparent-vs-opaque flip → re-propagate neighbors' light into this
   *     cell (or tear down this cell's light if it just became opaque)
   */
  markBlockChanged(chunk: Chunk, lx: number, ly: number, lz: number): void {
    const id = getBlock(chunk, lx, ly, lz);
    const em = emission(id);
    const prior = getBlockLight(chunk, lx, ly, lz);

    if (em > 0) {
      // New emitter — write the emission into the cell and seed an add.
      setBlockLight(chunk, lx, ly, lz, em);
      this.enqueueAdd(chunk, lx, ly, lz);
      return;
    }

    // No emission at this cell. If prior > 0 (e.g. this cell WAS a torch, now
    // air or opaque), tear down the old light.
    if (prior > 0) {
      // Clear this cell BEFORE queuing the removal so the de-light pass
      // doesn't see a stale value.
      setBlockLight(chunk, lx, ly, lz, 0);
      this.enqueueRemove(chunk, lx, ly, lz, prior);
    }

    // If the cell became opaque, also sweep its skylight to zero and seed a
    // sky-remove so the shadow spreads. For L4 we batch this with the
    // block-light remove path by just enqueuing an add at any still-lit
    // neighbor — simpler and correct for small cascades.
    if (!isTransparent(id)) {
      // Also clear block light in case there was none (idempotent).
      setBlockLight(chunk, lx, ly, lz, 0);
      // Any lit neighbors want to re-propagate INTO adjacent air after this
      // cell blocks their path. Enqueue them so the next step() reconsiders.
      for (const [dx, dy, dz] of NEIGHBORS) {
        const nc = this.neighborAt(chunk, lx + dx, ly + dy, lz + dz);
        if (!nc) continue;
        const { chunk: nChunk, lx: nx, ly: ny, lz: nz } = nc;
        if (getBlockLight(nChunk, nx, ny, nz) > 0 || getSkylight(nChunk, nx, ny, nz) > 0) {
          this.enqueueAdd(nChunk, nx, ny, nz);
        }
      }
      return;
    }

    // Became transparent (break of a solid) — re-propagate from any lit
    // neighbor into this newly-open cell.
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nc = this.neighborAt(chunk, lx + dx, ly + dy, lz + dz);
      if (!nc) continue;
      const { chunk: nChunk, lx: nx, ly: ny, lz: nz } = nc;
      if (getBlockLight(nChunk, nx, ny, nz) > 0 || getSkylight(nChunk, nx, ny, nz) > 0) {
        this.enqueueAdd(nChunk, nx, ny, nz);
      }
    }
  }

  /**
   * Pop up to `budget` seeds and propagate. Returns the number of seeds popped
   * so callers can log the frame cost. Caller is responsible for passing
   * `LIGHTING.DIRTY_QUEUE_BUDGET_PER_FRAME` from `design/config.ts`.
   */
  step(budget: number): number {
    let popped = 0;
    while (this.queue.length > 0 && popped < budget) {
      const seed = this.queue.shift()!;
      popped++;
      if (seed.kind === "add") {
        this.propagateAdd(seed.chunk, seed.lx, seed.ly, seed.lz);
      } else {
        this.propagateRemove(seed.chunk, seed.lx, seed.ly, seed.lz, seed.priorLevel ?? 0);
      }
    }
    return popped;
  }

  // -----------------------------------------------------------------
  // Internal: enqueuers
  // -----------------------------------------------------------------

  private enqueueAdd(chunk: Chunk, lx: number, ly: number, lz: number): void {
    const key = this.dedupeKey(chunk.coord, lx, ly, lz);
    if (this.addDedupe.has(key)) return;
    this.addDedupe.add(key);
    this.queue.push({ chunk, lx, ly, lz, kind: "add" });
  }

  private enqueueRemove(
    chunk: Chunk,
    lx: number,
    ly: number,
    lz: number,
    priorLevel: number,
  ): void {
    // No dedupe for removes — tracking the correct priorLevel per seed matters.
    this.queue.push({ chunk, lx, ly, lz, kind: "remove", priorLevel });
  }

  private dedupeKey(coord: ChunkCoord, lx: number, ly: number, lz: number): string {
    return `${coord.cx},${coord.cy},${coord.cz}:${chunkIndex(lx, ly, lz)}`;
  }

  // -----------------------------------------------------------------
  // Internal: 6-neighbor sampling with chunk-boundary crossing
  // -----------------------------------------------------------------

  private neighborAt(
    chunk: Chunk,
    lx: number,
    ly: number,
    lz: number,
  ): { chunk: Chunk; lx: number; ly: number; lz: number } | undefined {
    let nx = lx, ny = ly, nz = lz;
    let cx = chunk.coord.cx, cy = chunk.coord.cy, cz = chunk.coord.cz;
    if (nx < 0) { nx += CHUNK_SIZE; cx--; }
    else if (nx >= CHUNK_SIZE) { nx -= CHUNK_SIZE; cx++; }
    if (ny < 0) { ny += CHUNK_SIZE; cy--; }
    else if (ny >= CHUNK_SIZE) { ny -= CHUNK_SIZE; cy++; }
    if (nz < 0) { nz += CHUNK_SIZE; cz--; }
    else if (nz >= CHUNK_SIZE) { nz -= CHUNK_SIZE; cz++; }
    if (cx === chunk.coord.cx && cy === chunk.coord.cy && cz === chunk.coord.cz) {
      return { chunk, lx: nx, ly: ny, lz: nz };
    }
    const neighbor = this.world.getChunk({ cx, cy, cz });
    if (!neighbor) return undefined;
    return { chunk: neighbor, lx: nx, ly: ny, lz: nz };
  }

  // -----------------------------------------------------------------
  // Internal: propagation workers
  // -----------------------------------------------------------------

  private propagateAdd(chunk: Chunk, lx: number, ly: number, lz: number): void {
    this.addDedupe.delete(this.dedupeKey(chunk.coord, lx, ly, lz));
    const sourceBlk = getBlockLight(chunk, lx, ly, lz);
    const sourceSky = getSkylight(chunk, lx, ly, lz);
    if (sourceBlk === 0 && sourceSky === 0) return;

    for (const [dx, dy, dz] of NEIGHBORS) {
      const nc = this.neighborAt(chunk, lx + dx, ly + dy, lz + dz);
      if (!nc) continue;
      const { chunk: nChunk, lx: nx, ly: ny, lz: nz } = nc;
      const nid = getBlock(nChunk, nx, ny, nz);
      if (!isTransparent(nid)) continue;

      const atten = lightAttenuation(nid);

      // Block-light: standard decrement.
      if (sourceBlk > atten) {
        const newBlk = sourceBlk - atten;
        if (getBlockLight(nChunk, nx, ny, nz) < newBlk) {
          setBlockLight(nChunk, nx, ny, nz, newBlk);
          this.enqueueAdd(nChunk, nx, ny, nz);
        }
      }

      // Skylight: downward step from a MAX cell does not pay the per-block
      // falloff — direct sun is direct. Horizontal and upward steps pay the
      // standard attenuation. This keeps open columns at MAX all the way to
      // the surface AND lets overhangs darken with distance.
      if (sourceSky > 0) {
        const downStep =
          dy === -1 && sourceSky === LIGHTING.SUNLIGHT_LEVEL_MAX;
        const effectiveAtten = downStep ? 0 : atten;
        if (sourceSky > effectiveAtten) {
          const newSky = sourceSky - effectiveAtten;
          if (getSkylight(nChunk, nx, ny, nz) < newSky) {
            setSkylight(nChunk, nx, ny, nz, newSky);
            this.enqueueAdd(nChunk, nx, ny, nz);
          }
        }
      }
    }
  }

  private propagateRemove(
    chunk: Chunk,
    lx: number,
    ly: number,
    lz: number,
    priorLevel: number,
  ): void {
    if (priorLevel <= 0) return;
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nc = this.neighborAt(chunk, lx + dx, ly + dy, lz + dz);
      if (!nc) continue;
      const { chunk: nChunk, lx: nx, ly: ny, lz: nz } = nc;
      const neighborLevel = getBlockLight(nChunk, nx, ny, nz);
      if (neighborLevel === 0) continue;
      if (neighborLevel < priorLevel) {
        // This neighbor was lit by us — clear it and propagate the removal.
        setBlockLight(nChunk, nx, ny, nz, 0);
        this.enqueueRemove(nChunk, nx, ny, nz, neighborLevel);
        // If the neighbor is adjacent to another emitter that was previously
        // overridden, mark it so a re-add pass restores whatever remains.
        this.enqueueAdd(nChunk, nx, ny, nz);
      } else {
        // Neighbor is still fed by a brighter source — re-add from there to
        // restore any cells we incorrectly cleared.
        this.enqueueAdd(nChunk, nx, ny, nz);
      }
    }
    // After removing, if this cell itself is still an emitter (shouldn't be,
    // since markBlockChanged zeroed it), re-seed. Guard anyway.
    if (emission(getBlock(chunk, lx, ly, lz)) > 0) {
      setBlockLight(chunk, lx, ly, lz, emission(getBlock(chunk, lx, ly, lz)));
      this.enqueueAdd(chunk, lx, ly, lz);
    }
  }
}

// Silence unused symbol if the host hasn't wired `BLOCKS` yet — importing it
// surfaces the id constants in dev tools when breakpointing lighting.ts.
void BLOCKS;
