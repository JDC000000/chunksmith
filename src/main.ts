// Chunksmith — Day 2 integration: real voxel chunk replaces the blue cube.
// L3+ swaps the single chunk for a ChunkManager streaming around the player.

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { installDebugAPI } from "./debug/gameAPI";
import { DEV_SEED } from "./debug/seeds";
import { PLAYER, CAMERA } from "../design/config";
import { World } from "./world/World";
import { Chunk } from "./world/Chunk";
import { terrainAt } from "./gen/terrain";
import { meshChunk } from "./mesh/naiveMesher";
import { createChunkMaterial } from "./render/chunkMaterial";
import { buildChunkMesh } from "./render/chunkRenderer";

const container = document.getElementById("app")!;
const overlay   = document.getElementById("overlay")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky

const camera = new THREE.PerspectiveCamera(
  CAMERA.FOV_DEG,
  window.innerWidth / window.innerHeight,
  CAMERA.NEAR,
  CAMERA.FAR
);
camera.position.set(8, 4, 24); // outside the chunk, looking back at it

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(10, 20, 10);
scene.add(sun);

// === Voxel world ===
const world = new World(DEV_SEED);
const material = createChunkMaterial();

// Day 2: render a single 16x16x16 chunk at origin — the "Hello Voxel" moment.
// Day 4 upgrades to a ChunkManager streaming around the player.
const chunkCoord = { cx: 0, cy: 0, cz: 0 };
const chunk = new Chunk(chunkCoord, terrainAt(DEV_SEED, 0, 0, 0));
world.setChunk(chunk);
const meshData = meshChunk(chunk, {}); // no neighbors yet (Day 4 adds them)
const chunkMesh = buildChunkMesh(meshData, material);
scene.add(chunkMesh);
chunk.mesh = chunkMesh;

// === First-person controls ===
const controls = new PointerLockControls(camera, renderer.domElement);
overlay.addEventListener("click", () => controls.lock());
controls.addEventListener("lock",   () => overlay.classList.add("hidden"));
controls.addEventListener("unlock", () => overlay.classList.remove("hidden"));
scene.add(controls.object);

// Camera look-at: start angled toward the chunk so the player sees something immediately.
camera.lookAt(8, 1, 8);

// === Input ===
const keys: Record<string, boolean> = {};
window.addEventListener("keydown", (e) => { keys[e.code] = true;  });
window.addEventListener("keyup",   (e) => { keys[e.code] = false; });

// === Main loop ===
let last = performance.now();
let frameCount = 0;
let fpsLast = last;
let fps = 0;

function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (controls.isLocked) {
    const forward = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
    const right   = (keys["KeyD"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0);
    if (forward) controls.moveForward(forward * PLAYER.MOVE_SPEED_MPS * dt);
    if (right)   controls.moveRight(right   * PLAYER.MOVE_SPEED_MPS * dt);
  }

  renderer.render(scene, camera);

  frameCount++;
  if (now - fpsLast >= 1000) {
    fps = frameCount * 1000 / (now - fpsLast);
    frameCount = 0;
    fpsLast = now;
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// === Debug API for e2e ===
installDebugAPI({
  scene, camera, controls, renderer,
  world,
  getFps: () => fps,
  getChunkTriangleCount: () => meshData.triangleCount,
  getLoadedChunkCount: () => world.loadedChunkCount(),
});
