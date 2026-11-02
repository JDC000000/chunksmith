# ADR-0011: Persistence — IndexedDB chunk-delta via idb-keyval
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L3.md` §2.1, `TSD-L3.md` §5

## Context
L2 keeps edits in memory — close the tab, lose the world. L3 ships persistence. We need (a) edits that survive tab close + browser restart; (b) a storage shape that scales to long sessions without hitting the browser's ~50 MB-per-origin IDB quota; (c) a load path that respects "world is procedural" — if a chunk has never been edited, regenerate from seed rather than persist pristine terrain. A full-world snapshot (every visited chunk) would blow quota in under an hour of exploration (256 chunks × 4 KB × many visits).

## Decision
**IndexedDB via `idb-keyval`. Schema `chunk:${worldId}:${cx},${cy},${cz}` → `Uint8Array` (4096 bytes of chunk voxels). Only EDITED chunks are saved. Unedited chunks regenerate from seed on load. Debounced 5-second flush in `requestIdleCallback`. Meta key `meta:${worldId}` carries `{ seed, version, lastSaved }`.**

`worldId = "world-0"` for the L3 single-slot save (named worlds → L4).

A chunk becomes "dirty" the first time `World.applyBlockChange` touches it. The flusher batches all dirty chunks on a 5s debounce and clears their dirty flag after a successful write. On load, each chunk request checks IDB first; miss → fall through to the procedural generator.

## Consequences
**Positive**
- Quota-safe by construction. A heavy session of ~1000 edits across ~50 chunks persists ≤ 200 KB
- Load path is `IDB → generator`, so an untouched world is 0 bytes in storage
- `idb-keyval` is ~1 KB gz, Promise-based, dead simple
- Debounced + idle-callback flush → never blocks the main thread during interaction
- Netcode-ready: `applyBlockChange` already produces the `dirtyChunks` list from `BlockChangeResult`; the flusher consumes that same signal
- Version field in `meta` enables L4+ schema migrations without data loss
- `wipeWorld(worldId)` is a single-key delete sweep → one-click reset

**Negative**
- Only full-chunk payloads, not per-cell deltas. A chunk with one edited cell still saves 4 KB. Delta encoding is a documented L4 optimization (TSD-L3 §5.6)
- Not a "snapshot export" — users can't download their world. L4 export feature if demanded
- Private browsing mode may evict IDB — surface as a warning on load if `navigator.storage.persist()` fails; data loss is not a crash
- Browser quota exhaustion returns an error at write time — we log + stop flushing + warn user; no overwrite of good data
- Single `worldId` for L3 means two tabs edit the same world — potential race. Mitigation: `BroadcastChannel` ping so the newer tab wins; deferred to L3-9 adversarial pass

## Rejected alternatives

### Full-chunk IDB snapshots of every visited chunk
Pros: dead simple load — IDB is the source of truth, no fallback.
Cons: 256 chunks × 4 KB × every visited chunk × every session → quota blown in hours of play. Rejected.

### JSON export / import only (no auto-save)
Pros: trivial to implement, user owns their data.
Cons: user has to remember to click "save". If they close the tab, world is gone. Bad UX for a drop-in sandbox. Rejected as the primary mechanism (keep as L4 add-on).

### WebSQL / localStorage
Pros: localStorage is synchronous and simple.
Cons: localStorage is 5-10 MB per origin — tighter than IDB. Synchronous = blocks main thread. No binary type → base64-encode voxels → 33% size inflation. WebSQL is deprecated. Rejected both.

### OPFS (Origin Private File System)
Pros: real filesystem, fast binary IO.
Cons: still Chromium-biased for binary synchronous access; `idb-keyval` works everywhere today. Reconsider at L5 for multiplayer world cache. Rejected for L3.

### SharedArrayBuffer world cache
Pros: fast cross-worker access.
Cons: SAB is memory, not storage. Doesn't survive tab close. Orthogonal problem. Rejected.

## Verification
Unit test `tests/unit/idbStore.test.ts` (Day L3-2):
- Save → load roundtrip preserves bytes
- Debounce coalesces N writes within 5 s into 1 flush (fake timers)
- `wipeWorld` clears all keys matching `chunk:world-0:*`

E2E tests (Day L3-6):
- `tests/e2e/persistence-idb.spec.ts`: place 3 blocks → `page.reload()` → same 3 blocks at same coords
- `tests/e2e/wipe.spec.ts`: wipe button → reload → procedural restored (US-L3-08)

Adversarial (Day L3-9) — `tests/e2e/persistence-adversarial.spec.ts`:
- edit → reload → edit → reload × 10: no drift, no duplicates
- 10k synthetic edits across 50 chunks: IDB usage ≤ 50 MB; no main-thread stall > 50 ms
- Simulated quota-exceeded: write fails gracefully, logs warning, state in memory intact

## Cost of change
Adding delta encoding at L4: wraps `saveChunk` + `loadChunk` behind the same signature, decodes on read, encodes on write; version bump in `meta` triggers one-time migration pass that rewrites all L3 chunks. ~1 day of focused work. Adding named worlds at L4: `worldId` already parameterizes every API — surface a picker UI, no schema change.
