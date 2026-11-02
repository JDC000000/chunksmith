# ADR-0015: Inventory serialization — separate playerState IDB record
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L4.md` §2.1 (widget 3), `docs/levels/level-4.md` Day L4-5
**Decider:** `game-designer` subagent on Jon's blanket "creative, contemporary, a bit fun" approval

## Context
L4 adds a 27-slot backpack UI on top of the L2 hotbar. Items (hotbar + backpack) need to survive a page refresh. The widget asked WHERE those bytes live. Candidates:
- **(a) Merge into IDB chunk-delta** — tag the player's chunk-delta record with a `playerInventory` field
- **(b) Separate `playerState` IDB record keyed by seed** — a sibling key `<WORLD_ID>:player` holds a JSON blob of inventory + any other player-scoped state

## Decision
**(b) Separate `playerState` IDB record.** Hotbar + backpack + any future player-scoped state (position, orientation, flight-on, selected-slot) persist to IDB key `<PERSISTENCE.WORLD_ID><INVENTORY.PLAYER_STATE_KEY_SUFFIX>` → e.g. `world-0:player`. Schema:
```
{
  version: INVENTORY.PLAYER_STATE_VERSION,
  hotbar: [ { blockId: number, count: number } | null ] × 9,
  backpack: [ { blockId: number, count: number } | null ] × 27,
  selectedHotbarSlot: 0..8,
  flying: boolean,
  position: { x, y, z },
  yawPitch: { yaw, pitch },
}
```

Writes are debounced by the existing `ChunkPersistence` idle loop (one additional entry in its pending set keyed on `"player"`). `beforeunload` flush covers abrupt close.

Config under `INVENTORY` namespace:
- `BACKPACK_SLOTS = 27`, `HOTBAR_SLOTS = 9`, `MAX_STACK_SIZE = 64`
- `OPEN_CLOSE_ANIM_MS = 140` — modern-snappy, iOS-ish
- `SPLIT_HOLD_MS = 0` — instant drag-split
- `PLAYER_STATE_KEY_SUFFIX = ":player"`, `PLAYER_STATE_VERSION = 1`

## Consequences
**Positive**
- Clean separation of concerns: world-delta is per-chunk; player state is per-player (critical at L5 netcode where several players share chunks but each has their own inventory)
- Inventory corruption cannot corrupt the world and vice versa (adversarial IDB risk mitigation)
- Writes are small (JSON ~1 KB) and infrequent — negligible IDB load
- Schema is JSON, not a binary byte array — introspectable in DevTools without a parser
- Version field in place for L5 breaking shape changes

**Negative**
- An extra IDB key per world — one more thing to track in `clearWorld` / `listSavedChunks`
- Loader must read two shapes at page load (chunk-delta + player state) — adds ~1 ms to warm-up

## Rejected alternatives
### (a) Merge into IDB chunk-delta
Pros: one record format.
Cons: couples the two worst scopes to swap at L5 (world is shared, inventory isn't); schema bump requires rewriting every chunk-delta record. Rejected.

## Verification
Unit test `tests/unit/playerState.test.ts` (Day L4-5):
- `savePlayerState` + `loadPlayerState` round-trip returns identical object
- `loadPlayerState` under a mismatched `PLAYER_STATE_VERSION` returns `undefined` (schema isolation)
- `clearWorld` removes both `<WORLD_ID>:chunk-*` keys AND the `<WORLD_ID>:player` key

E2E test `tests/e2e/inventory-idb.spec.ts` (Day L4-5):
- Open backpack, place 32 stone in slot 0, close, refresh page
- Open backpack, assert slot 0 still has 32 stone (US-L4-12)
- Repeat with hotbar + selected slot + flight state

## Cost of change
Changing to merged chunk-delta later: migration path = read both shapes, write once in merged form, drop old key. Changing stack size: `INVENTORY.MAX_STACK_SIZE`. Changing slot count: `INVENTORY.BACKPACK_SLOTS` + UI reflow.
