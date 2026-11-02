// window.__game — dev/e2e-only surface for Playwright tests + manual debugging.
// EXCLUDED from production build by main.ts conditional in Day 7 (not implemented yet).
// For now it's always on — fine while we're not deployed.

import type * as THREE from "three";
import type { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

export interface GameAPI {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: PointerLockControls;
  renderer: THREE.WebGLRenderer;
  getFps: () => number;
  getCube: () => THREE.Mesh;
  version: string;
}

declare global {
  interface Window {
    __game?: GameAPI;
  }
}

export function installDebugAPI(parts: Omit<GameAPI, "version">): void {
  const api: GameAPI = Object.assign({ version: "0.1.0-day1" }, parts);
  (window as unknown as { __game: GameAPI }).__game = api;
  // Signal to Playwright that the game has booted.
  window.dispatchEvent(new CustomEvent("game:ready"));
}
