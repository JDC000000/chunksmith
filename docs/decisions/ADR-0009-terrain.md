# ADR-0009: Terrain — multi-octave simplex heightmap + 3D cave noise
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L3.md` §2.1, `TSD-L3.md` §2

## Context
L3 replaces the L2 superflat world with real terrain: hills to climb, caves to find. We need a procedural generator that is (a) continuous across chunk boundaries, (b) deterministic from a seed string so our golden-hash test holds across machines, (c) cheap enough to produce a chunk in ≤100 ms cold, and (d) bundle-friendly. We do not need biomes, rivers, or structures at L3 — those are L4+.

## Decision
**Multi-octave 2D simplex heightmap for ground elevation, plus a single 3D simplex noise field for cave carving.** Both channels are fed by one PRNG constructed from one seed string, in a documented order (TSD-L3 §3.3).

Four octaves on the heightmap (`amp=[16,8,4,2]`, `freq=[1/256,1/128,1/64,1/32]`); one 3D cave channel at `freq=1/32`, threshold `0.58` → ~15% void volume. Cave cells are suppressed within 3 m of the surface so caves cannot open at spawn.

Library: `simplex-noise` v4 (jwagner), ~8 KB gz, MIT.

## Consequences
**Positive**
- Continuous across chunk boundaries by construction — no seams
- Deterministic: same seed → byte-identical chunks on any machine (locked by golden-hash test in `terrain.golden.test.ts`)
- Cheap: 4 octaves of 2D + 1 octave of 3D ≈ `16*16*16 * 5` noise samples ≈ 20480 samples per chunk → well under 100 ms budget
- Small bundle cost (~8 KB gz)
- Visually: rolling hills ±~30 m above baseY=32, caves readable but not overwhelming

**Negative**
- No biome variety at L3 — world looks like one aesthetic (grass over dirt over stone). Deliberate; biomes are L4
- 3D cave noise occasionally carves a floating "sky bubble" — tolerable at L3, cosmetic polish only
- Changing octave count, order, or seeds in the future is a terrain-identity break (treat as schema migration)

## Rejected alternatives

### Pure Perlin (classic Ken Perlin 1983)
Produces visible axis-aligned grid artifacts ("Perlin banding") at low frequencies — easy to spot on hilltops. Simplex (same author, 2001) was designed to fix exactly this. Rejected.

### Diamond-square (midpoint displacement)
Pros: dead simple, famously used in classic terrain demos.
Cons: produces fractal plasma that is **not continuous across chunks** without a global grid. We'd need to pre-generate a world-size grid or tile the chunks via awkward boundary stitching. For an "infinite" chunked world, this is the wrong primitive. Rejected.

### Worley / cellular noise as the primary signal
Pros: produces nice irregular cellular shapes.
Cons: cellular distance fields are the right primitive for *biome boundaries* or *cave starts* but a poor primary height signal — they look like crumpled paper, not terrain. Reconsider at L4 for biome-flavor noise layered on top. Rejected as the primary.

### Pre-generated world baked into bundle
Pros: no runtime cost.
Cons: breaks the "infinite" promise, bloats bundle. Rejected.

## Verification
Unit tests in `tests/unit/terrain.test.ts` (Day L3-2):
- Height variance over 1000 (x,z) samples under `E2E_SEED` is > 4 m²
- Cave fraction in a 32³ region below surface is in [10%, 20%]
- No cave cell within 3 m of the surface
- Spawn at `(0, h(0,0)+2, 0)` is in air with solid ground below

Golden hash test in `tests/unit/terrain.golden.test.ts`:
- FNV-1a of 27-chunk sample `(0,0,0)..(2,2,2)` equals the locked constant
- Replaces L2's `4286672581`; new hash locked on Day L3-2 and never changed absent a new ADR

## Cost of change
Swapping noise libraries or adding biomes at L4 is additive on top of this generator (new 2D field selects biome; biome index parameterizes amp/freq). The 4-channel heightmap + 1-channel cave structure is the stable contract.
