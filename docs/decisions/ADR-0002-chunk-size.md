# ADR-0002: Chunk Size (16×16×16, not 32×32×32)
**Status:** Accepted
**Date:** 2026-11-02

## Context
The voxel world data model needs a chunk size: the atomic unit of storage, mesh regeneration, worker transfer, and persistence. Candidates: 8³, 16³, 32³, or 16×16×256 (Minecraft-column-style). Trade-offs cross cache fit, re-mesh cost on single-block edit, worker transfer bandwidth.

## Decision
**16×16×16 chunks, `Uint8Array(4096)`, index `x + z*16 + y*256`.**

## Consequences
**Positive**
- 4 KB fits L1 CPU cache; hot meshing inner loop stays fast
- `Uint8Array` is Transferable zero-copy to workers
- Single-block edit forces re-mesh of only one 4 KB chunk (+ ≤6 neighbors on boundary) → <50 ms budget met
- 8H × 4V radius = 256 chunks ≈ 1 MB RAM
- Matches Minecraft architecture → ample reference material
- Palette compression (bit-packed indices) addable later without changing index formula

**Negative**
- More chunks in flight than 32³ scheme — slightly busier `Map<string, Chunk>` lookups (O(1), tolerable)
- Vertical streaming adds complexity vs Minecraft's 16×16×256 columns — trade accepted to preserve L3 vertical-world optionality
- Mesher must handle neighbor-chunk border visibility (not just same-chunk air) — enforced by Day 5 acceptance test

## Rejected alternatives
- **32³ (32 KB per chunk):** falls out of L1 cache, re-mesh cost cubes on edit → misses 50 ms budget
- **8³ (512 B):** chunk count explodes 8×, O(1) Map lookups become 8× noisier, no perf win
- **16×16×256 columns:** hard-codes 256 vertical — breaks L3+ sky-island/deep-cave vertical streaming
- **3D arrays `arr[x][y][z]`:** objects-of-objects, cache-hostile, no worker transferability

## Verification
Unit tests in `tests/unit/chunk.test.ts` (write in Day 2) lock in:
- `chunkIndex(x, y, z) === x + z*16 + y*256` for all 4096 positions
- `(cx, cy, cz) → chunkKey → parsed back` identity
- Chunk voxels buffer is 4096 bytes
- `voxels.buffer` is Transferable

## Cost of change
Post-Day-2: 2-3 focused days (new ADR + TSD §2.2 + rewrite tests + rewrite mesher inner loop + rewrite terrain worker + IDB migrator). Choose carefully upfront.
