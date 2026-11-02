# ADR-0010: Jump feel + step-up — fixed impulse, Y-last sweep
**Status:** Accepted
**Date:** 2026-11-02
**Context docs:** `PRD-L3.md` §2.1, `TSD-L3.md` §4, `ADR-0005-physics.md`

## Context
L3 adds gravity, jumping, and 1-block ledge step-up to the player. We need (a) a jump that feels right for a voxel sandbox at first attempt — not floaty, not stiff; (b) a step-up that lets the player walk up a 1-block ledge without catching on the lip; (c) a creative-flight toggle that disables gravity when active. These three systems share the same swept-AABB solver (ADR-0005); the open questions are the physical constants and the axis order.

## Decision
**Fixed jump impulse of 9 m/s. Gravity 32 m/s². Step-up max 1 block. Swept-AABB axis order X → Z → Y (Y last).**

Space tap jumps (on-ground only). Space double-tap (two presses within 300 ms) toggles creative flight: gravity ignored, Space ascends, Shift descends.

Constants live in `design/config.ts` under `PHYSICS` (owned by `game-designer`):
```typescript
PHYSICS = {
  GRAVITY_MPS2: 32,
  JUMP_IMPULSE_MPS: 9,          // → ~1.26 m apex, ~0.56 s airtime
  TERMINAL_VELOCITY_MPS: 54,
  STEP_UP_MAX_BLOCKS: 1,
  FLIGHT_SPEED_MULT: 2,
  SUBSTEP_WHEN_DT_OVER: 1/30,
}
```

## Consequences
**Positive**
- Standard voxel-sandbox feel out of the gate; matches intuition for anyone who has played any first-person block game
- 9 / 32 math: apex = v²/(2g) = 81/64 ≈ 1.27 m — just over 1 block, so a jump clears a 1-block ledge without having to step-up
- Y-last axis order means horizontal movement into a 1-block ledge resolves X/Z first (lands on top of the block), then Y (lifts onto it) — step-up is a free consequence of sweep order plus a 1-block vertical probe
- Flight toggle is pure state flip, no shader or world changes — easy to unit test
- All numbers in `design/config.ts` → game-designer can tune without touching physics code

**Negative**
- No variable jump height (holding Space longer does NOT jump higher). Deliberate — see rejected alternative
- Terminal velocity is deliberately low (54 m/s) to prevent tunneling at long falls; a 100 m freefall caps at 54 m/s not sqrt(2*32*100)=80. Visually unnoticeable
- Fixed step-up means stairs must be 1-block risers. A 1.5-block ledge requires a jump. Fine for L3

## Rejected alternatives

### Variable jump height on hold (platformer-style)
Pros: more expressive movement; standard in 2D platformers.
Cons: in a first-person voxel sandbox, variable hold feels floaty — the player loses the direct cause-effect of a tap. Most voxel sandbox games converged on fixed impulse. Rejected for L3 (reconsider at L4 if playtest demands).

### Velocity-based step-up (project horizontal velocity into Y when colliding with a 1-block ledge)
Pros: no second sweep pass needed.
Cons: adds a special-case branch inside the sweep solver; interacts badly with slopes and ladders should they arrive at L4. Y-last ordering is simpler, provably correct, and already in `ADR-0005-physics.md`. Rejected.

### Rapier/cannon-es character controller
See `ADR-0005-physics.md` for the full rejection. Overkill for an axis-aligned grid. Still rejected at L3.

### Make Space toggle flight on single press (no double-tap)
Pros: cheaper input handling.
Cons: single-press is already the jump action. Double-tap keeps Space as "primary jump" with flight as a secondary intent. Rejected single-press.

## Verification
Unit tests in `tests/unit/physics.test.ts` (Day L3-2):
- Spawn at y=20 above floor at y=0; after 1 s sim, `vy ≈ -32` m/s (±0.5)
- After 3 s sim, `grounded === true`, player at floor
- On ground, call `jump()`; peak `y - startY ∈ [1.0, 1.4]`; airtime ≤ 0.9 s
- Walk +x at vel=(3,0,0) into a single 1-block step; after sweep, `y` increased by 1.0 m, `vx` unchanged
- Walk +x at vel=(100,0,0) over `dt = 1/60` with sub-stepping: no tunneling through 1-block wall
- Toggle flight: `vy = 0`, `flying = true`; gravity disabled next tick

E2E test in `tests/e2e/flight.spec.ts`:
- Double-tap Space → `window.__game.player.flying === true`
- Double-tap again → `flying === false`, gravity restored

## Cost of change
If playtest at Day L3-4 says "floaty": lower `JUMP_IMPULSE_MPS` to 8.5 or raise `GRAVITY_MPS2` to 36 — pure `design/config.ts` edits, no physics code change, re-run unit tests to re-validate apex bounds. Zero cost of change for tuning. Zero cost of change for variable-hold jump later: add a `JUMP_HOLD_BOOST` constant that applies while Space is held and `vy > 0` — purely additive.
