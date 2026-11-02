import { describe, test, expect } from "vitest";
import { hitToIntent } from "../../src/player/applyBlockFromHit";
import type { RaycastHit } from "../../src/player/raycast";
import { BLOCKS } from "../../src/world/blocks";
import type { PlayerId } from "../../src/world/types";

const PID = "player-1" as PlayerId;

/** A canonical hit: we struck the -x face of the block at (5,0,0). */
const HIT: RaycastHit = {
  cell: { x: 5, y: 0, z: 0 },
  face: "-x",
  distance: 5,
  normal: { x: -1, y: 0, z: 0 },
};

describe("hitToIntent", () => {
  test("break: intent.pos equals hit.cell (the block being removed)", () => {
    const intent = hitToIntent(HIT, "break", BLOCKS.air, PID);
    expect(intent.reason).toBe("break");
    expect(intent.pos).toEqual({ x: 5, y: 0, z: 0 });
    expect(intent.playerId).toBe(PID);
  });

  test("place: intent.pos is hit.cell + hit.normal (adjacent empty cell on the face side)", () => {
    const intent = hitToIntent(HIT, "place", BLOCKS.stone, PID);
    expect(intent.reason).toBe("place");
    // Face -x → normal -x → place to the -x of the hit cell.
    expect(intent.pos).toEqual({ x: 4, y: 0, z: 0 });
    expect(intent.blockId).toBe(BLOCKS.stone);
  });

  test("timestamp is a positive number (Date.now)", () => {
    const before = Date.now();
    const intent = hitToIntent(HIT, "break", BLOCKS.air, PID);
    const after = Date.now();
    expect(typeof intent.timestamp).toBe("number");
    expect(intent.timestamp).toBeGreaterThan(0);
    // Also sanity-check it's a real wall-clock stamp, not some constant.
    expect(intent.timestamp).toBeGreaterThanOrEqual(before);
    expect(intent.timestamp).toBeLessThanOrEqual(after);
  });
});
