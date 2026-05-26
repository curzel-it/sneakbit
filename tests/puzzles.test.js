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
const { findPushableAt, pushOneTile } = await import("../js/pushables.js");
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

test("pushable: refuses to move into a wall", () => {
  const zone = makeZone();
  zone.collision[2][3] = true;
  const box = { species_id: 1030, lock_type: "None", frame: { x: 2, y: 2, w: 1, h: 1 } };
  zone.entities.push(box);
  assert.equal(pushOneTile(zone, box, "right"), false);
  assert.equal(box.frame.x, 2);
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
