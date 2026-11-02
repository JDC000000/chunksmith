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
import { PLAYER, CAMERA, WORLD, PHYSICS, PERSISTENCE } from "../design/config";
import { World } from "./world/World";
import type { Chunk } from "./world/Chunk";
import { terrainAt, surfaceHeightAt } from "./gen/terrain";
import { meshChunk } from "./mesh/naiveMesher";
import type { ChunkNeighbors } from "./mesh/naiveMesher";
import { createChunkMaterial } from "./render/chunkMaterial";
import { createBlockTextureArray } from "./render/textures";
import { buildChunkMesh } from "./render/chunkRenderer";
import { ChunkManager } from "./world/ChunkManager";
import type { ChunkStreamUpdate } from "./world/ChunkManager";
import { raycastVoxels } from "./player/raycast";
import { hitToIntent } from "./player/applyBlockFromHit";
import { stepPhysics } from "./player/physics";
import type { PhysicsState } from "./player/physics";
import { stepDayNight } from "./render/dayNight";
import { ChunkPersistence } from "./world/storage";
import { initHotbar } from "./ui/hotbar";
import { getSelectedBlock } from "./ui/HotbarState";
import type { PlayerId } from "./world/types";

const container = document.getElementById("app")!;
const overlay   = document.getElementById("overlay")!;
const crosshair = document.getElementById("crosshair")!;
const toast     = document.getElementById("toast")!;

/** Playtest-friendly brief message near center, fades after 1.5s. */
let toastTimer: number | undefined;
function flashToast(msg: string): void {
  toast.textContent = msg;
  toast.classList.add("show");
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1500);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // sky

const camera = new THREE.PerspectiveCamera(
  CAMERA.FOV_DEG,
  window.innerWidth / window.innerHeight,
  CAMERA.NEAR,
  CAMERA.FAR
);
// L3 spawn: raycast the heightmap for the spawn column + lift 5 blocks for a
// clear view. SPAWN_FLYING=true (design/config) means player can fly down to the
// surface at their own pace — no fall required. Reach of 6 blocks is enough to
// touch terrain within a short descent.
const spawnX = 8, spawnZ = 24;
const spawnSurfaceY = surfaceHeightAt(DEV_SEED, spawnX, spawnZ);
camera.position.set(spawnX, spawnSurfaceY + 5, spawnZ);

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
const atlas = createBlockTextureArray();
const material = createChunkMaterial(atlas);

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

// L3 persistence: debounced IDB chunk-delta saves. World ID is single-world "world-0"
// per widget decision. markDirty on each successful block change, start the periodic
// flush loop, flush on beforeunload so an abrupt tab-close still saves.
const persistence = new ChunkPersistence(PERSISTENCE.WORLD_ID, PERSISTENCE.FLUSH_INTERVAL_MS);
persistence.start();
window.addEventListener("beforeunload", () => {
  // Fire-and-forget — IDB transaction kicks off synchronously enough for most browsers.
  void persistence.flush();
});

const chunkManager = new ChunkManager(
  world, terrainAt, attachMesh, disposeChunk, radiusH, radiusV, persistence,
);

// Streaming stats: updated every call to chunkManager.update().
let lastStreamUpdate: ChunkStreamUpdate = { added: [], removed: [] };
let totalStreamingMs = 0;
let streamUpdateCount = 0;

/**
 * Load every desired chunk through primeChunk (IDB-first, else procedural), then
 * run the sync update() to attach meshes. Called at startup and on every chunk
 * crossing — fire-and-forget while the game loop keeps running.
 */
let streamInFlight: Promise<void> | null = null;
async function streamUpdateAsync(wx: number, wy: number, wz: number): Promise<void> {
  const target = chunkManager.playerChunk(wx, wy, wz);
  const primes: Promise<unknown>[] = [];
  for (let cy = target.cy - radiusV; cy <= target.cy + radiusV; cy++) {
    for (let cz = target.cz - radiusH; cz <= target.cz + radiusH; cz++) {
      for (let cx = target.cx - radiusH; cx <= target.cx + radiusH; cx++) {
        primes.push(chunkManager.primeChunk({ cx, cy, cz }));
      }
    }
  }
  await Promise.all(primes);
  const t0 = performance.now();
  lastStreamUpdate = chunkManager.update(wx, wy, wz);
  totalStreamingMs += performance.now() - t0;
  streamUpdateCount += 1;
}

/** Prime the world: load every initial chunk (IDB or procedural) before the game loop. */
{
  const t0 = performance.now();
  await streamUpdateAsync(camera.position.x, camera.position.y, camera.position.z);
  const dt = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(
    `[chunksmith] initial stream: ${lastStreamUpdate.added.length} chunks loaded in ${dt.toFixed(1)}ms`,
  );
}

// === First-person controls ===
const controls = new PointerLockControls(camera, renderer.domElement);
overlay.addEventListener("click", () => controls.lock());
controls.addEventListener("lock",   () => { overlay.classList.add("hidden");  crosshair.classList.add("on"); });
controls.addEventListener("unlock", () => { overlay.classList.remove("hidden"); crosshair.classList.remove("on"); });
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
  if (!hit) {
    lastBlockChangeStats.lastResult = "miss";
    flashToast(`${reason === "break" ? "⛏ break" : "+ place"}: out of reach (${PLAYER.REACH_BLOCKS} blocks)`);
    return;
  }

  const blockId = getSelectedBlock();
  const intent = hitToIntent(hit, reason, blockId, PLAYER_ID);
  const result = world.applyBlockChange(intent);
  if (!result.ok) {
    lastBlockChangeStats.lastResult = result.reason;
    flashToast(`${reason === "break" ? "⛏ break" : "+ place"} refused: ${result.reason}`);
    return;
  }

  if (reason === "break") lastBlockChangeStats.broken += 1;
  else lastBlockChangeStats.placed += 1;
  lastBlockChangeStats.lastResult = "ok";
  flashToast(reason === "break"
    ? `⛏ broke @ (${hit.cell.x}, ${hit.cell.y}, ${hit.cell.z})`
    : `+ placed @ (${hit.cell.x + hit.normal.x}, ${hit.cell.y + hit.normal.y}, ${hit.cell.z + hit.normal.z})`);

  // Remesh the edited chunk + boundary neighbors so the change is visible, and
  // mark the mutated chunk dirty for the next IDB flush.
  for (const key of result.dirtyChunks) {
    const [cx, cy, cz] = key.split(",").map(Number);
    const c = world.getChunk({ cx, cy, cz });
    if (!c) continue;
    persistence.markDirty(c);
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
// Suppress browser context menu so right-click (Mac trackpad two-finger / Ctrl-click) reaches
// mousedown. Listen on both canvas AND window — on Mac trackpad the contextmenu sometimes
// fires on document before Chrome routes it to canvas during pointer-lock.
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("contextmenu", (e) => { if (controls.isLocked) e.preventDefault(); });

// Camera look-at: start angled toward the origin chunk so the player sees something.
// Look at the terrain surface ahead of the player, not an arbitrary (8,1,8) that
// may now be inside a hill at the new world shape.
camera.lookAt(spawnX, surfaceHeightAt(DEV_SEED, spawnX, spawnZ - 8), spawnZ - 8);

// === L3 physics state ===
// camera.position is the player's EYE position; physicsState.position is FEET.
// Keep them in lockstep: camera.y = physics.y + EYE_HEIGHT every frame.
const EYE_HEIGHT = PLAYER.AABB_HEIGHT_BLOCKS * 0.9; // 1.62m — eyes near top of 1.8m AABB
const physicsState: PhysicsState = {
  position: { x: camera.position.x, y: camera.position.y - EYE_HEIGHT, z: camera.position.z },
  velocity: { x: 0, y: 0, z: 0 },
  grounded: false,
  flying: PHYSICS.SPAWN_FLYING, // widget decision: spawn in flight mode
};

// Day/night: lock startSec at page load. 10-min cycle, starts at noon (0.5) per widget.
const dayNightStartSec = performance.now() / 1000;

// === Input ===
const keys: Record<string, boolean> = {};
/** Edge-triggered jump: set true on fresh Space press, consumed by one physics tick. */
let jumpQueued = false;
window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.repeat) return;
  // F toggles flight mode. Ground is checked on fall after disable, so re-enable safely.
  if (e.code === PHYSICS.FLIGHT_TOGGLE_KEY) {
    physicsState.flying = !physicsState.flying;
    if (physicsState.flying) physicsState.velocity.y = 0;
    flashToast(`✈ flight: ${physicsState.flying ? "on" : "off"}`);
    return;
  }
  // Space jumps when NOT flying; when flying, Space is held for upward motion (handled in tick).
  if (e.code === "Space" && !physicsState.flying) jumpQueued = true;
});
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

// Reused per-frame scratch vector so we don't allocate inside tick().
const forwardScratch = new THREE.Vector3();

function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (controls.isLocked) {
    const forward = (keys["KeyW"] ? 1 : 0) - (keys["KeyS"] ? 1 : 0);
    const right   = (keys["KeyD"] ? 1 : 0) - (keys["KeyA"] ? 1 : 0);
    // Flying: Space=up / Shift=down for free vertical. Grounded: Space already queued as jump.
    const up = physicsState.flying
      ? (keys["Space"] ? 1 : 0) - (keys["ShiftLeft"] || keys["ShiftRight"] ? 1 : 0)
      : 0;

    // Build horizontal camera basis for stepPhysics (yaw only — pitch doesn't move the player).
    camera.getWorldDirection(forwardScratch);
    forwardScratch.y = 0;
    const fvLen = Math.hypot(forwardScratch.x, forwardScratch.z);
    const cameraForward = fvLen > 1e-6
      ? { x: forwardScratch.x / fvLen, y: 0, z: forwardScratch.z / fvLen }
      : { x: 0, y: 0, z: -1 };
    // Right = forward rotated -90° around Y (y-up right-handed world).
    const cameraRight = { x: -cameraForward.z, y: 0, z: cameraForward.x };

    const next = stepPhysics({
      state: physicsState,
      input: { forward, right, up, jump: jumpQueued },
      world,
      cameraForward,
      cameraRight,
      dt,
    });
    jumpQueued = false; // one-shot per Space press
    physicsState.position = next.position;
    physicsState.velocity = next.velocity;
    physicsState.grounded = next.grounded;
    // Keep eye in lockstep with feet.
    camera.position.set(next.position.x, next.position.y + EYE_HEIGHT, next.position.z);
  }

  // Day/night: update the shader uniforms + sky color every frame (cheap).
  const dnState = stepDayNight(now / 1000, dayNightStartSec);
  material.updateDayNight(dnState);
  (scene.background as THREE.Color).setRGB(dnState.skyColor.r, dnState.skyColor.g, dnState.skyColor.b);

  // Re-stream when the player crossed into a new chunk — async so IDB-saved deltas load.
  // In-flight guard prevents overlapping updates during rapid crossings.
  const cc = chunkManager.playerChunk(camera.position.x, camera.position.y, camera.position.z);
  if (
    !streamInFlight &&
    (cc.cx !== lastChunkCoord.cx || cc.cy !== lastChunkCoord.cy || cc.cz !== lastChunkCoord.cz)
  ) {
    lastChunkCoord = cc;
    streamInFlight = streamUpdateAsync(camera.position.x, camera.position.y, camera.position.z)
      .finally(() => { streamInFlight = null; });
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
      persistence.markDirty(c);
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
