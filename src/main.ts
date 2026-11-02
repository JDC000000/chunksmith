// Chunksmith — Day 1: scene bootstrap + first-person controls + blue cube.
// Deliberately minimal. L2+ replaces the single BoxGeometry with a chunk system.

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { installDebugAPI } from "./debug/gameAPI";

const container = document.getElementById("app")!;
const overlay   = document.getElementById("overlay")!;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(10, 20, 10);
scene.add(sun);

// L1: a single blue cube at origin. L2 replaces this with a Chunk.
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0x3b82f6 })
);
cube.position.set(0, 0.5, 0);
scene.add(cube);

// A ground plane so you can orient yourself.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(50, 50),
  new THREE.MeshLambertMaterial({ color: 0x7cb342 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// First-person controls
const controls = new PointerLockControls(camera, renderer.domElement);
overlay.addEventListener("click", () => controls.lock());
controls.addEventListener("lock",   () => overlay.classList.add("hidden"));
controls.addEventListener("unlock", () => overlay.classList.remove("hidden"));
scene.add(controls.object);

// Movement input
const keys: Record<string, boolean> = {};
window.addEventListener("keydown", (e) => { keys[e.code] = true;  });
window.addEventListener("keyup",   (e) => { keys[e.code] = false; });

// Movement speed (will migrate to design/config.ts in Day 2)
const MOVE_SPEED = 5; // units / second

// Delta-timed loop
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
    if (forward) controls.moveForward(forward * MOVE_SPEED * dt);
    if (right)   controls.moveRight(right   * MOVE_SPEED * dt);
  }

  renderer.render(scene, camera);

  // Lightweight FPS calc for debug API
  frameCount++;
  if (now - fpsLast >= 1000) {
    fps = frameCount * 1000 / (now - fpsLast);
    frameCount = 0;
    fpsLast = now;
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug API for e2e tests
installDebugAPI({
  scene, camera, controls, renderer,
  getFps: () => fps,
  getCube: () => cube,
});
