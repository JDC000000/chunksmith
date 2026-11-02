# ADR-0017: Torch rendering — emissive shader channel driven by uBlockLight
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L4.md` §2.1 (widget 5), `docs/levels/level-4.md` Day L4-3/L4-4
**Decider:** `game-designer` subagent on Jon's blanket "creative, contemporary, a bit fun" approval

## Context
Torches emit light. ADR-0014 locked the propagation algorithm (incremental dirty-queue). This ADR locks HOW the computed per-cell light level reaches the pixel. Candidates:
- **(a) Emissive shader channel driven by `uBlockLight`** — the per-cell light byte becomes a vertex attribute; fragment shader modulates albedo by `max(sunlight, blocklight / 15)` plus a flicker term
- **(b) Per-torch `THREE.PointLight` with 32-cap** — one real three.js point light per placed torch, capped at 32 active lights (hardware uniform limit)

## Decision
**(a) Emissive shader channel driven by `uBlockLight`.** The lighting data IS the look: the fragment shader samples the per-vertex block-light byte, maps `0..15 → 0..1`, lerps with a 2D perlin flicker (`TORCH_FLICKER_HZ`, `TORCH_FLICKER_AMPLITUDE`), clamps against `TORCH_BRIGHTNESS_MIN`, and modulates albedo. Final per-fragment:
```glsl
float sky = vSkylight / 15.0;                   // 0..1
float blk = vBlockLight / 15.0;                 // 0..1
float flk = 1.0 + TORCH_FLICKER_AMPLITUDE *
            noise(vWorldPos.xz * FLICKER_SCALE + uTime * TORCH_FLICKER_HZ);
float light = max(sky, max(TORCH_BRIGHTNESS_MIN * blk, blk) * flk);
gl_FragColor.rgb = albedo * light;
```

The mesher writes `vSkylight` and `vBlockLight` as per-vertex u8 attributes from the chunk's `light` byte array (ADR-0014). No new three.js scene lights are added.

Config under `LIGHTING` namespace (same block as propagation — one system, one home).

## Consequences
**Positive**
- Single system drives both the lighting DATA (ADR-0014) and the LOOK — the shader IS the propagation result rendered
- Scales to unbounded torch count (500+ in a megabase) — no light-count cap
- Flicker is free (fragment shader perlin), reads as a living flame, not a point light
- No new scene graph nodes per torch — placing 100 torches adds 100 blocks, not 100 three.js objects
- Composes cleanly with day/night: sky and torch are independent channels, `max()` picks whichever is brighter

**Negative**
- Lighting is "voxel-flat" per-face — no soft falloff gradient within a block (classic voxel look)
- Shadows from torches are implicit (dark cells next to lit cells) — no cast-shadow geometry
- Flicker correlates across all torches at the same world position — intentional (looks like weather), could feel samey in a cave of 50 torches; `FLICKER_SCALE` tuned to break the correlation
- Gamma matters: current `DAY_NIGHT.AMBIENT_FLOOR = 0.35` washes torches out — flagged for Day L4-1 re-tune review

## Rejected alternatives
### (b) Per-torch `THREE.PointLight` with 32-cap
Pros: physically correct, free bump-map interaction, soft falloff.
Cons: torch #33 is dark — players notice immediately. Draw-call cost per torch. Doesn't compose with voxel-flat aesthetic. Rejected.

## Verification
Unit test `tests/unit/torchShader.test.ts` (Day L4-4):
- Mesher writes per-vertex `blockLight` and `skylight` attributes with correct byte values from the chunk's light array
- Shader is compiled; uniforms `TORCH_FLICKER_HZ`, `TORCH_FLICKER_AMPLITUDE`, `TORCH_BRIGHTNESS_MIN` are present

E2E test `tests/e2e/torchlight.spec.ts` (Day L4-4):
- Place torch at (10, 10, 10) in a dark cave screenshot
- Mean luminance of lit face ≥ mean luminance of unlit face + 60/255 (US-L4-08)
- Place torch, break torch, assert area returns to pre-torch luminance within ≤ 1 s

## Cost of change
Changing flicker feel: `LIGHTING.TORCH_FLICKER_HZ` or `TORCH_FLICKER_AMPLITUDE`. Changing brightness floor: `TORCH_BRIGHTNESS_MIN`. Swapping to point-lights: remove the vertex attribute path + instantiate `THREE.PointLight` per torch (full rebuild of lighting module).
