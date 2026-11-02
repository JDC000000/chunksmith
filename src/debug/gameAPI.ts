// window.__game — dev/e2e-only surface for Playwright tests + manual debugging.
// EXCLUDED from production build by main.ts conditional in Day 7 (not implemented yet).

import type * as THREE from "three";
import type { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { World } from "../world/World";

export interface GameAPI {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: PointerLockControls;
  renderer: THREE.WebGLRenderer;
  world: World;
  getFps: () => number;
  getChunkTriangleCount: () => number;
  getLoadedChunkCount: () => number;
  version: string;
}

declare global {
  interface Window {
    __game?: GameAPI;
  }
}

export function installDebugAPI(parts: Omit<GameAPI, "version">): void {
  const api: GameAPI = Object.assign({ version: "0.2.0-day2" }, parts);
  (window as unknown as { __game: GameAPI }).__game = api;
  // Signal to Playwright that the game has booted.
  window.dispatchEvent(new CustomEvent("game:ready"));
}
