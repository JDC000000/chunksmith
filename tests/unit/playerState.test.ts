// Player state persistence — US-L4-12 unit side.
// ADR-0015: separate IDB record keyed by `<WORLD_ID>:player`. The world-delta
// store (chunk-* keys) stays independent so inventory corruption cannot leak
// into chunk bytes and vice versa.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { INVENTORY } from "../../design/config";
import {
  clearPlayerState,
  defaultPlayerState,
  loadPlayerState,
  playerStateKey,
  savePlayerState,
  type InventoryStack,
  type PlayerState,
} from "../../src/world/playerState";
import { get as idbGet, set as idbSet, keys as idbKeys } from "idb-keyval";

let worldId: string;
let seq = 0;
beforeEach(() => {
  seq++;
  worldId = `test-world-ps-${Date.now()}-${seq}`;
});
afterEach(async () => {
  await clearPlayerState(worldId);
});

/** Build a representative, non-default state for round-trip tests. */
function sampleState(): PlayerState {
  const hotbar: Array<InventoryStack | null> = Array(INVENTORY.HOTBAR_SLOTS).fill(null);
  hotbar[0] = { blockId: 3, count: 32 }; // stone x32
  hotbar[1] = { blockId: 1, count: 64 }; // grass x64 (full stack)
  hotbar[8] = { blockId: 6, count: 7 };  // torch x7
  const backpack: Array<InventoryStack | null> = Array(INVENTORY.BACKPACK_SLOTS).fill(null);
  backpack[0] = { blockId: 2, count: 64 }; // dirt
  backpack[26] = { blockId: 9, count: 12 }; // snow
  return {
    version: INVENTORY.PLAYER_STATE_VERSION,
    hotbar,
    backpack,
    selectedHotbarSlot: 2,
    flying: true,
    position: { x: 12.5, y: 65.25, z: -3.75 },
    yawPitch: { yaw: 1.23, pitch: -0.4 },
  };
}

describe("defaultPlayerState — shape", () => {
  test("hotbar has HOTBAR_SLOTS entries, all null", () => {
    const s = defaultPlayerState();
    expect(s.hotbar.length).toBe(INVENTORY.HOTBAR_SLOTS);
    expect(s.hotbar.every((e) => e === null)).toBe(true);
  });
  test("backpack has BACKPACK_SLOTS entries, all null", () => {
    const s = defaultPlayerState();
    expect(s.backpack.length).toBe(INVENTORY.BACKPACK_SLOTS);
    expect(s.backpack.every((e) => e === null)).toBe(true);
  });
  test("selectedHotbarSlot = 0, flying = PHYSICS.SPAWN_FLYING default", () => {
    const s = defaultPlayerState();
    expect(s.selectedHotbarSlot).toBe(0);
    expect(typeof s.flying).toBe("boolean");
  });
  test("default version matches INVENTORY.PLAYER_STATE_VERSION", () => {
    expect(defaultPlayerState().version).toBe(INVENTORY.PLAYER_STATE_VERSION);
  });
});

describe("savePlayerState / loadPlayerState — round-trip", () => {
  test("save then load returns a structurally-equal state (US-L4-12)", async () => {
    const state = sampleState();
    await savePlayerState(worldId, state);
    const got = await loadPlayerState(worldId);
    expect(got).toBeDefined();
    expect(got).toEqual(state);
  });

  test("loadPlayerState for a never-saved world returns undefined", async () => {
    const got = await loadPlayerState(`${worldId}-never`);
    expect(got).toBeUndefined();
  });

  test("savePlayerState overwrites prior state for same worldId", async () => {
    const s1 = sampleState();
    await savePlayerState(worldId, s1);
    const s2 = defaultPlayerState();
    s2.selectedHotbarSlot = 7;
    await savePlayerState(worldId, s2);
    const got = await loadPlayerState(worldId);
    expect(got).toBeDefined();
    expect(got!.selectedHotbarSlot).toBe(7);
    expect(got!.hotbar[0]).toBeNull();
  });

  test("clearPlayerState removes the key", async () => {
    await savePlayerState(worldId, sampleState());
    expect(await loadPlayerState(worldId)).toBeDefined();
    await clearPlayerState(worldId);
    expect(await loadPlayerState(worldId)).toBeUndefined();
  });
});

describe("storage — key shape and schema isolation", () => {
  test("playerStateKey composes worldId + INVENTORY.PLAYER_STATE_KEY_SUFFIX", () => {
    const key = playerStateKey("world-0");
    expect(key).toBe(`world-0${INVENTORY.PLAYER_STATE_KEY_SUFFIX}`);
  });

  test("savePlayerState writes to the composed key", async () => {
    await savePlayerState(worldId, sampleState());
    const stored = await idbGet(playerStateKey(worldId));
    expect(stored).toBeDefined();
    // Shape check: has top-level version/hotbar/backpack fields.
    const obj = stored as PlayerState;
    expect(obj.version).toBe(INVENTORY.PLAYER_STATE_VERSION);
    expect(obj.hotbar.length).toBe(INVENTORY.HOTBAR_SLOTS);
  });

  test("loadPlayerState under a MISMATCHED PLAYER_STATE_VERSION returns undefined", async () => {
    // Simulate an upgrade bump: a stored record from a prior version lands in
    // IDB. Our loader must NOT return it (ADR-0015 schema isolation) — the UI
    // caller sees `undefined` and falls through to defaultPlayerState.
    const stale = {
      ...sampleState(),
      version: INVENTORY.PLAYER_STATE_VERSION - 1,
    };
    await idbSet(playerStateKey(worldId), stale);
    const got = await loadPlayerState(worldId);
    expect(got).toBeUndefined();
  });
});

describe("storage — isolation from chunk-delta keys", () => {
  test("the player key is not matched by chunk-delta prefix (chunk:v)", async () => {
    await savePlayerState(worldId, sampleState());
    const all = (await idbKeys()) as IDBValidKey[];
    const ours = all.filter((k) => typeof k === "string" && (k as string).includes(worldId));
    // Exactly one key for this world — the player state.
    expect(ours.length).toBe(1);
    const key = ours[0] as string;
    expect(key.startsWith("chunk:")).toBe(false);
    expect(key.endsWith(INVENTORY.PLAYER_STATE_KEY_SUFFIX)).toBe(true);
  });
});
