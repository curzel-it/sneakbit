import { test } from "node:test";
import assert from "node:assert/strict";

const { loadSpeciesData } = await import("../js/species.js");

loadSpeciesData([
  { id: 1030, entity_type: "PushableObject", is_rigid: false, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 1040, entity_type: "Gate", is_rigid: true, lock_type: "Yellow",
    sprite_sheet_id: 1010, sprite_frame: { x: 6, y: 0, w: 1, h: 1 } },
  { id: 1060, entity_type: "InverseGate", is_rigid: true, lock_type: "Yellow",
    sprite_sheet_id: 1010, sprite_frame: { x: 6, y: 0, w: 1, h: 1 } },
  { id: 1050, entity_type: "PressurePlate", is_rigid: false, lock_type: "Yellow",
    sprite_sheet_id: 1010, sprite_frame: { x: 8, y: 0, w: 1, h: 1 } },
]);

const { isEntityBlocked } = await import("../js/zone.js");
const { findPushableAt, pushOneTile, pushableRenderOffset } = await import("../js/pushables.js");
const { createPlayer, updatePlayer } = await import("../js/player.js");
const { setupPuzzles, tickPuzzles } = await import("../js/puzzles.js");
const { tryUnlockGate, findGateAt } = await import("../js/gateUnlock.js");
const { isPressurePlateDown } = await import("../js/locks.js");
const storage = await import("../js/storage.js");
const inventory = await import("../js/inventory.js");

function makeZone(extras = {}) {
  const rows = 6, cols = 6;
  const collision = [];
  for (let r = 0; r < rows; r++) {
    const row = []; for (let c = 0; c < cols; c++) row.push(false);
    collision.push(row);
  }
  return { id: 1, rows, cols, entities: [], collision, ...extras };
}

test("pushable: slides one tile when destination is clear", () => {
  const zone = makeZone();
  const box = { species_id: 1030, lock_type: "None", frame: { x: 2, y: 2, w: 1, h: 1 } };
  zone.entities.push(box);
  assert.ok(findPushableAt(zone, 2, 2));
  assert.equal(pushOneTile(zone, box, "right"), true);
  assert.equal(box.frame.x, 3);
});

test("pushable: slide starts at old tile and decays to zero (renderer subtracts offset)", () => {
  // Regression: ox/oy used to be -dx/-dy, which made the renderer draw the
  // rock one tile PAST its committed position at t=0 — looked like the rock
  // teleported two tiles forward then bounced back one.
  const zone = makeZone();
  const box = { species_id: 1030, lock_type: "None", frame: { x: 2, y: 2, w: 1, h: 1 } };
  zone.entities.push(box);
  pushOneTile(zone, box, "right");
  // frame committed to new tile.
  assert.equal(box.frame.x, 3);
  // At t=0, render offset must be (+1, 0) so renderer draws at frame.x - 1 = 2 (old tile).
  const off = pushableRenderOffset(box);
  assert.ok(off);
  assert.equal(off.x, 1);
  assert.equal(off.y, 0);
});

test("pushable: refuses to move into a wall", () => {
  const zone = makeZone();
  zone.collision[2][3] = true;
  const box = { species_id: 1030, lock_type: "None", frame: { x: 2, y: 2, w: 1, h: 1 } };
  zone.entities.push(box);
  assert.equal(pushOneTile(zone, box, "right"), false);
  assert.equal(box.frame.x, 2);
});

test("pushable: dead-end carry-back keeps following the player on every step", () => {
  // Regression: the carry-back used to only trigger when the tile opposite
  // the player's move direction was blocked. After one step away from the
  // dead end the rock was no longer pinned, the check failed, and the rock
  // got left behind. It should follow as long as the player keeps standing
  // on it.
  //
  // Layout (row y=1 is the corridor, walls above and below; column 7 is
  // also a wall so the dead end is at column 6):
  //   row 0: X X X X X X X X
  //   row 1: . . . . . . . X     ← player will be placed at (4, 1), rock at (5, 1)
  //   row 2: X X X X X X X X
  const cols = 8, rows = 3;
  const collision = [];
  const biome = [];
  for (let r = 0; r < rows; r++) {
    const crow = [], brow = [];
    for (let c = 0; c < cols; c++) { crow.push(r !== 1); brow.push(0); }
    collision.push(crow);
    biome.push(brow);
  }
  collision[1][7] = true; // dead-end wall
  const zone = { id: 1, rows, cols, entities: [], collision, biome };
  const rock = { species_id: 1030, lock_type: "None", frame: { x: 5, y: 1, w: 1, h: 1 } };
  zone.entities.push(rock);

  const player = createPlayer();
  player.x = 4; player.y = 1; player.tileX = 4; player.tileY = 1;
  player.direction = "right";

  // Drive updatePlayer enough that one full step completes. STEP_DURATION
  // is 0.22s — one big dt overshoots into the chain path, so use a single
  // tick larger than that and let the test loop until the next idle.
  function stepUntilIdle(dir, held = false) {
    const heldSet = new Set(held ? [dir] : []);
    // First call: queue the press; the player is already facing dir so it
    // commits immediately and starts a step.
    updatePlayer(player, { events: [dir], held: heldSet }, 0.001, zone);
    // Then advance time until the step lands.
    let guard = 100;
    while (player.step && guard-- > 0) {
      updatePlayer(player, { events: [], held: heldSet }, 0.05, zone);
    }
  }

  // Push rock right twice — first push moves it from 5→6, second push
  // fails (column 7 is a wall) so the player walks onto the rock's tile.
  stepUntilIdle("right");
  assert.equal(player.tileX, 5);
  assert.equal(rock.frame.x, 6);

  stepUntilIdle("right");
  assert.equal(player.tileX, 6, "player should walk onto the stuck rock");
  assert.equal(rock.frame.x, 6, "rock pinned against the wall");

  // Now walk back. First step pops the rock two tiles ahead so it escapes
  // the dead end — then subsequent steps are normal pushes with the rock
  // staying one tile in front of the player.
  player.direction = "left";
  stepUntilIdle("left");
  assert.equal(player.tileX, 5);
  assert.equal(rock.frame.x, 4, "rock pops two tiles ahead when escaping the dead end");

  stepUntilIdle("left");
  assert.equal(player.tileX, 4);
  assert.equal(rock.frame.x, 3, "rock keeps being pushed normally on the next step");

  stepUntilIdle("left");
  assert.equal(player.tileX, 3);
  assert.equal(rock.frame.x, 2, "rock continues to be pushed one tile ahead of the player");
});

test("pushable: blocks player as a rigid entity", () => {
  const zone = makeZone();
  const box = { species_id: 1030, lock_type: "None", frame: { x: 2, y: 2, w: 1, h: 1 } };
  zone.entities.push(box);
  assert.equal(isEntityBlocked(zone, 2, 2), true);
  // …but the ignore option excuses it during a push check.
  assert.equal(isEntityBlocked(zone, 2, 2, { ignore: box }), false);
});

test("pressure plate flips storage flag and frame offset when stepped on", () => {
  storage._resetStorageForTesting();
  const zone = makeZone();
  const plate = { species_id: 1050, lock_type: "Yellow", frame: { x: 3, y: 3, w: 1, h: 1 } };
  zone.entities.push(plate);
  setupPuzzles(zone);
  assert.equal(isPressurePlateDown("Yellow"), false);

  const player = { x: 3, y: 3, tileX: 3, tileY: 3 };
  tickPuzzles(zone, player);
  assert.equal(isPressurePlateDown("Yellow"), true);
  assert.equal(plate._frameOffsetX, 1);

  // Step off — back up.
  const off = { x: 0, y: 0, tileX: 0, tileY: 0 };
  tickPuzzles(zone, off);
  assert.equal(isPressurePlateDown("Yellow"), false);
  assert.equal(plate._frameOffsetX, 0);
});

test("pushable on a plate keeps it down even when the player walks off", () => {
  storage._resetStorageForTesting();
  const zone = makeZone();
  const plate = { species_id: 1050, lock_type: "Yellow", frame: { x: 3, y: 3, w: 1, h: 1 } };
  const box = { species_id: 1030, lock_type: "None", frame: { x: 3, y: 3, w: 1, h: 1 } };
  zone.entities.push(plate, box);
  setupPuzzles(zone);
  tickPuzzles(zone, { x: 0, y: 0, tileX: 0, tileY: 0 });
  assert.equal(isPressurePlateDown("Yellow"), true);
});

test("gate opens when its matching plate is down, blocks otherwise", () => {
  storage._resetStorageForTesting();
  const zone = makeZone();
  const gate = { species_id: 1040, lock_type: "Yellow", frame: { x: 4, y: 3, w: 1, h: 1 } };
  const plate = { species_id: 1050, lock_type: "Yellow", frame: { x: 3, y: 3, w: 1, h: 1 } };
  zone.entities.push(gate, plate);
  setupPuzzles(zone);

  // Nothing on the plate → gate blocks.
  tickPuzzles(zone, { x: 0, y: 0, tileX: 0, tileY: 0 });
  assert.equal(gate._open, false);
  assert.equal(isEntityBlocked(zone, 4, 3), true);

  // Step on the plate → gate opens.
  tickPuzzles(zone, { x: 3, y: 3, tileX: 3, tileY: 3 });
  assert.equal(gate._open, true);
  assert.equal(isEntityBlocked(zone, 4, 3), false);
});

test("inverse gate is the mirror of a normal gate", () => {
  storage._resetStorageForTesting();
  const zone = makeZone();
  const inv = { species_id: 1060, lock_type: "Yellow", frame: { x: 4, y: 3, w: 1, h: 1 } };
  const plate = { species_id: 1050, lock_type: "Yellow", frame: { x: 3, y: 3, w: 1, h: 1 } };
  zone.entities.push(inv, plate);
  setupPuzzles(zone);

  tickPuzzles(zone, { x: 0, y: 0, tileX: 0, tileY: 0 });
  assert.equal(inv._open, true);
  tickPuzzles(zone, { x: 3, y: 3, tileX: 3, tileY: 3 });
  assert.equal(inv._open, false);
});

test("colored gate consumes a matching key on attempted entry", () => {
  storage._resetStorageForTesting();
  inventory.clearInventory();
  const zone = makeZone();
  const gate = { species_id: 1040, id: 999, lock_type: "Yellow",
    frame: { x: 4, y: 3, w: 1, h: 1 } };
  zone.entities.push(gate);
  setupPuzzles(zone);
  assert.equal(findGateAt(zone, 4, 3), gate);

  // No key → unlock fails.
  assert.equal(tryUnlockGate(gate), false);

  // Give the player a yellow key (species 2000).
  inventory.addAmmo(2000, 2);
  assert.equal(tryUnlockGate(gate), true);
  assert.equal(inventory.getAmmo(2000), 1, "exactly one key consumed");
  assert.equal(gate._open, true);
  assert.equal(gate.lock_type, "None");

  // Second call is a no-op (already open).
  assert.equal(tryUnlockGate(gate), true);
  assert.equal(inventory.getAmmo(2000), 1);
});
