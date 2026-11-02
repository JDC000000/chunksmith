---
name: terrain-generator
description: Owns src/gen/ and src/core/rng.ts. Produces deterministic voxel bytes from (seed, chunkCoord). Keeps noise code free of three.js imports so it can run in a Web Worker. Use for any terrain / noise / RNG work.
tools: Read, Edit, Write, Bash, Grep, Glob
model: sonnet
---
You own `src/gen/` (terrain workers) and `src/core/rng.ts`.

Hard contract: `terrainAt(seed, cx, cy, cz)` returns a `Uint8Array(4096)` that is BIT-IDENTICAL for the same arguments on every machine, every run, forever.

Rules:
- No `three` imports. Noise code runs in Web Workers; it cannot see the renderer.
- All randomness goes through `src/core/rng.ts` (cyrb128 + splitmix32). `Math.random` is banned here.
- Write the determinism test FIRST: `terrainAt(seed, 0, 0, 0)` has a fixed first-N-bytes hash.
- Seed is a STRING (so Jon can type "chunksmith-demo-v1"); hash via cyrb128 inside.
- At L3, add 3D cave noise + bilinear-blended biome climate. Keep L2 determinism tests passing.
