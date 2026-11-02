// Chunksmith — Day 4 integration: ChunkManager streams chunks around the player.
// Keeps a 3D box of chunks (±RENDER_RADIUS_CHUNKS horizontally, ±VERTICAL_RADIUS_CHUNKS
// vertically) resident around wherever the player stands. Terrain + mesh for each
// freshly-entered chunk is generated on the fly; chunks that walked out of range
// are evicted and their GPU buffers disposed.
//
// A URL param `?radius=H[,V]` overrides the config radii — handy for e2e budgets
// (SwiftShader-backed headless Chromium chokes above a few hundred chunks).

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { installDebugAPI } from "./debug/gameAPI";
import { DEV_SEED } from "./debug/seeds";
import { PLAYER, CAMERA, WORLD } from "../design/config";
import { World } from "./world/World";
import type { Chunk } from "./world/Chunk";
import { terrainAt } from "./gen/terrain";
import { meshChunk } from "./mesh/naiveMesher";
import type { ChunkNeighbors } from "./mesh/naiveMesher";
import { createChunkMaterial } from "./render/chunkMaterial";
import { buildChunkMesh } from "./render/chunkRenderer";
import { ChunkManager } from "./world/ChunkManager";
import type { ChunkStreamUpdate } from "./world/ChunkManager";
import { raycastVoxels } from "./player/raycast";
import { hitToIntent } from "./player/applyBlockFromHit";
import { initHotbar } from "./ui/hotbar";
import { getSelectedBlock } from "./ui/HotbarState";
import type { PlayerId } from "./world/types";

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
// Spawn above-and-behind the origin chunk so the terrain is immediately visible.
camera.position.set(8, 20, 48);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(10, 20, 10);
scene.add(sun);

// === Voxel world + chunk streaming ===
const world = new World(DEV_SEED);
const material = createChunkMaterial();

// Radius override via ?radius=H or ?radius=H,V — defaults to config values.
// Default config (8H, 4V) → 17*17*9 = 2601 chunks; too heavy for headless SwiftShader.
const params = new URLSearchParams(window.location.search);
const [rhStr, rvStr] = (params.get("radius") ?? "").split(",");
const radiusH = Number.isFinite(Number(rhStr))
  ? Math.max(0, Number(rhStr))
  : WORLD.RENDER_RADIUS_CHUNKS;
const radiusV = Number.isFinite(Number(rvStr))
  ? Math.max(0, Number(rvStr))
  : rhStr && Number.isFinite(Number(rhStr))
    ? Math.max(0, Number(rhStr))
    : WORLD.VERTICAL_RADIUS_CHUNKS;

/** Replace a chunk's attached THREE.Mesh (cleaning up any prior buffers). */
function attachMesh(chunk: Chunk, neighbors: ChunkNeighbors): void {
  // Clean up any mesh the chunk was carrying before — this path hits when a
  // neighbor chunk is remeshed because its exposed-face set changed.
  const prior = chunk.mesh as THREE.Mesh | undefined;
  if (prior) {
    scene.remove(prior);
    prior.geometry.dispose();
  }
  const data = meshChunk(chunk, neighbors);
  if (data.triangleCount === 0) {
    // Nothing visible: stash the empty mesh-data for triangle accounting but
    // don't push an empty draw call to the GPU.
    chunk.mesh = { triangleCount: 0 };
    return;
  }
  const mesh = buildChunkMesh(data, material);
  scene.add(mesh);
  chunk.mesh = mesh;
}

function disposeChunk(chunk: Chunk): void {
  const m = chunk.mesh as THREE.Mesh | undefined;
  if (m && (m as THREE.Mesh).geometry) {
    scene.remove(m);
    (m as THREE.Mesh).geometry.dispose();
  }
  chunk.mesh = undefined;
}

const chunkManager = new ChunkManager(
  world, terrainAt, attachMesh, disposeChunk, radiusH, radiusV,
);

// Streaming stats: updated every call to chunkManager.update().
let lastStreamUpdate: ChunkStreamUpdate = { added: [], removed: [] };
let totalStreamingMs = 0;
let streamUpdateCount = 0;

/** Prime the world: run one update at the spawn position so the player sees terrain. */
{
  const t0 = performance.now();
  lastStreamUpdate = chunkManager.update(camera.position.x, camera.position.y, camera.position.z);
  const dt = performance.now() - t0;
  totalStreamingMs += dt;
  streamUpdateCount += 1;
  // eslint-disable-next-line no-console
  console.log(
    `[chunksmith] initial stream: ${lastStreamUpdate.added.length} chunks loaded in ${dt.toFixed(1)}ms`,
  );
}

// === First-person controls ===
const controls = new PointerLockControls(camera, renderer.domElement);
overlay.addEventListener("click", () => controls.lock());
controls.addEventListener("lock",   () => overlay.classList.add("hidden"));
controls.addEventListener("unlock", () => overlay.classList.remove("hidden"));
scene.add(controls.object);

// === Hotbar (Day 6) ===
initHotbar();

// === Place / break (Day 5+6) ===
// Click handler: left-click → break, right-click → place.
// Only acts when pointer-locked so the hotbar + overlay keep working outside the game.
const PLAYER_ID = "local" as PlayerId;
let lastBlockChangeStats = { placed: 0, broken: 0, lastResult: "" as string };

function onMouseDown(e: MouseEvent): void {
  if (!controls.isLocked) return;
  // 0 = left (break), 2 = right (place). Middle click is ignored.
  let reason: "break" | "place";
  if (e.button === 0) reason = "break";
  else if (e.button === 2) reason = "place";
  else return;

  const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const dir = { x: forward.x, y: forward.y, z: forward.z };

  const hit = raycastVoxels(world, origin, dir, PLAYER.REACH_BLOCKS);
  if (!hit) { lastBlockChangeStats.lastResult = "miss"; return; }

  const blockId = getSelectedBlock();
  const intent = hitToIntent(hit, reason, blockId, PLAYER_ID);
  const result = world.applyBlockChange(intent);
  if (!result.ok) { lastBlockChangeStats.lastResult = result.reason; return; }

  if (reason === "break") lastBlockChangeStats.broken += 1;
  else lastBlockChangeStats.placed += 1;
  lastBlockChangeStats.lastResult = "ok";

  // Remesh the edited chunk + boundary neighbors so the change is visible.
  for (const key of result.dirtyChunks) {
    const [cx, cy, cz] = key.split(",").map(Number);
    const c = world.getChunk({ cx, cy, cz });
    if (!c) continue;
    attachMesh(c, {
      px: world.getChunk({ cx: cx + 1, cy, cz }),
      nx: world.getChunk({ cx: cx - 1, cy, cz }),
      py: world.getChunk({ cx, cy: cy + 1, cz }),
      ny: world.getChunk({ cx, cy: cy - 1, cz }),
      pz: world.getChunk({ cx, cy, cz: cz + 1 }),
      nz: world.getChunk({ cx, cy, cz: cz - 1 }),
    });
  }
}
renderer.domElement.addEventListener("mousedown", onMouseDown);
// Suppress browser context menu so right-click reaches the mousedown handler.
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

// Camera look-at: start angled toward the origin chunk so the player sees something.
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

// Track the last chunk coord so we only run chunkManager.update() when the
// player actually crosses a chunk boundary. ChunkManager also short-circuits
// internally, but doing it here avoids computing the key set every frame.
let lastChunkCoord = chunkManager.playerChunk(
  camera.position.x, camera.position.y, camera.position.z,
);

function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (controls.isLocked) {
    const forward = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
    const right   = (keys["KeyD"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0);
    if (forward) controls.moveForward(forward * PLAYER.MOVE_SPEED_MPS * dt);
    if (right)   controls.moveRight(right   * PLAYER.MOVE_SPEED_MPS * dt);
  }

  // Only re-stream when the player crossed into a new chunk.
  const cc = chunkManager.playerChunk(camera.position.x, camera.position.y, camera.position.z);
  if (cc.cx !== lastChunkCoord.cx || cc.cy !== lastChunkCoord.cy || cc.cz !== lastChunkCoord.cz) {
    const t0 = performance.now();
    lastStreamUpdate = chunkManager.update(camera.position.x, camera.position.y, camera.position.z);
    totalStreamingMs += performance.now() - t0;
    streamUpdateCount += 1;
    lastChunkCoord = cc;
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

// === Total triangle count across all loaded chunks ===
function getTotalTriangleCount(): number {
  let total = 0;
  for (const key of world.loadedChunkKeys()) {
    const [cx, cy, cz] = key.split(",").map(Number);
    const c = world.getChunk({ cx, cy, cz });
    const m = c?.mesh as { triangleCount?: number; geometry?: { index?: { count: number } } } | undefined;
    if (!m) continue;
    if (typeof m.triangleCount === "number") {
      total += m.triangleCount;
    } else if (m.geometry?.index) {
      total += m.geometry.index.count / 3;
    }
  }
  return total;
}

// === Debug API for e2e ===
installDebugAPI({
  scene, camera, controls, renderer,
  world,
  getFps: () => fps,
  getChunkTriangleCount: getTotalTriangleCount, // Day 4: sum across streamed chunks
  getLoadedChunkCount: () => world.loadedChunkCount(),
  getTotalTriangleCount,
  chunkManager,
  getStreamStats: () => ({
    radiusH, radiusV,
    lastAdded: lastStreamUpdate.added.length,
    lastRemoved: lastStreamUpdate.removed.length,
    totalStreamingMs,
    streamUpdateCount,
  }),
  getSelectedBlock,
  getBlockChangeStats: () => ({ ...lastBlockChangeStats }),
  // Day 5: Playwright helper — place/break at a world coord without needing pointer-lock.
  // Shares the exact same code path as the mouse handler (raycast is bypassed; applyBlockChange
  // + remesh is identical). This is intentionally lean — e2e tests should still prefer
  // moving the camera + clicking in future, but headless pointer-lock + raycast is flaky.
  simulateBlockChange: (reason, x, y, z) => {
    const intent = {
      playerId: PLAYER_ID,
      pos: { x, y, z },
      blockId: getSelectedBlock(),
      reason,
      timestamp: Date.now(),
    };
    const result = world.applyBlockChange(intent);
    if (!result.ok) { lastBlockChangeStats.lastResult = result.reason; return result.reason; }
    if (reason === "break") lastBlockChangeStats.broken += 1;
    else lastBlockChangeStats.placed += 1;
    lastBlockChangeStats.lastResult = "ok";
    for (const key of result.dirtyChunks) {
      const [cx, cy, cz] = key.split(",").map(Number);
      const c = world.getChunk({ cx, cy, cz });
      if (!c) continue;
      attachMesh(c, {
        px: world.getChunk({ cx: cx + 1, cy, cz }),
        nx: world.getChunk({ cx: cx - 1, cy, cz }),
        py: world.getChunk({ cx, cy: cy + 1, cz }),
        ny: world.getChunk({ cx, cy: cy - 1, cz }),
        pz: world.getChunk({ cx, cy, cz: cz + 1 }),
        nz: world.getChunk({ cx, cy, cz: cz - 1 }),
      });
    }
    return "ok";
  },
});
