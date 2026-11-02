// window.__game — dev/e2e-only surface for Playwright tests + manual debugging.
// EXCLUDED from production build by main.ts conditional in Day 7 (not implemented yet).

import type * as THREE from "three";
import type { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { World } from "../world/World";
import type { ChunkManager } from "../world/ChunkManager";
import type { BlockId } from "../world/blocks";

export interface StreamStats {
  radiusH: number;
  radiusV: number;
  lastAdded: number;
  lastRemoved: number;
  totalStreamingMs: number;
  streamUpdateCount: number;
}

export interface BlockChangeStats {
  placed: number;
  broken: number;
  lastResult: string;
}

export interface GameAPI {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: PointerLockControls;
  renderer: THREE.WebGLRenderer;
  world: World;
  getFps: () => number;
  /** Day 4: sum of triangles across every loaded chunk mesh. */
  getChunkTriangleCount: () => number;
  getLoadedChunkCount: () => number;
  /** Day 4: alias of getChunkTriangleCount kept for callers that want the explicit name. */
  getTotalTriangleCount: () => number;
  /** Day 4: chunk streaming entry point for debug / tests. */
  chunkManager: ChunkManager;
  /** Day 4: last-stream deltas + rolling perf stats. */
  getStreamStats: () => StreamStats;
  /** Day 5: currently selected block from the hotbar. */
  getSelectedBlock: () => BlockId;
  /** Day 5: rolling counts of player edits. */
  getBlockChangeStats: () => BlockChangeStats;
  /** Day 5: fire a synthetic place/break at the given world coord (bypasses raycast). */
  simulateBlockChange: (reason: "place" | "break", x: number, y: number, z: number) => string;
  version: string;
}

declare global {
  interface Window {
    __game?: GameAPI;
  }
}

export function installDebugAPI(parts: Omit<GameAPI, "version">): void {
  const api: GameAPI = Object.assign({ version: "0.5.0-day5" }, parts);
  (window as unknown as { __game: GameAPI }).__game = api;
  // Signal to Playwright that the game has booted.
  window.dispatchEvent(new CustomEvent("game:ready"));
}
