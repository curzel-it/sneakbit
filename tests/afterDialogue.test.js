// After-dialogue disappearance behaviors — pure logic, no DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { handleAfterDialogue, tickAfterDialogue } from "../js/afterDialogue.js";
import { isDying } from "../js/deathAnimation.js";
import * as storage from "../js/storage.js";
import { _setCreativeModeForTesting } from "../js/creativeMode.js";

// A small all-walkable zone with an optional teleporter at (0,0).
function makeZone({ teleporter = false } = {}) {
  const cols = 5, rows = 5;
  const collision = Array.from({ length: rows }, () => Array(cols).fill(false));
  const entities = [];
  if (teleporter) {
    entities.push({
      id: 99, species_id: 1019, destination: { zone: "x" },
      frame: { x: 0, y: 0, w: 1, h: 1 },
    });
  }
  return { cols, rows, collision, entities };
}

function npc(after_dialogue) {
  return { id: 7, species_id: 2000, after_dialogue, direction: "down",
           frame: { x: 2, y: 2, w: 1, h: 1 }, dialogues: [{ text: "hi" }] };
}

test("Disappear removes the entity and persists collection", () => {
  storage._resetStorageForTesting();
  _setCreativeModeForTesting(false);
  const zone = makeZone();
  const e = npc("Disappear");
  zone.entities.push(e);
  handleAfterDialogue(zone, e);
  assert.ok(!zone.entities.includes(e), "removed");
  assert.equal(storage.getValue("item_collected.7"), 1, "collected flag set");
});

test("VanishSmoke / VanishTeleport play an in-place effect then persist on removal", () => {
  for (const beh of ["VanishSmoke", "VanishTeleport"]) {
    storage._resetStorageForTesting();
    _setCreativeModeForTesting(false);
    const zone = makeZone();
    const e = npc(beh);
    zone.entities.push(e);
    handleAfterDialogue(zone, e);
    assert.equal(isDying(e), true, `${beh}: entity is dying`);
    assert.ok(e._deathSprite, `${beh}: has an effect sprite`);
    assert.ok(zone.entities.includes(e), `${beh}: stays while the effect plays`);
    // Burn through its lifespan — tickDeathAnimations (combat tick) owns the
    // actual removal, but the onRemove hook must persist collection.
    e._onDeathRemove();
    assert.equal(storage.getValue("item_collected.7"), 1, `${beh}: collected flag set`);
  }
});

test("WalkToNearestExit stashes a path toward the teleporter", () => {
  storage._resetStorageForTesting();
  _setCreativeModeForTesting(false);
  const zone = makeZone({ teleporter: true });
  const e = npc("WalkToNearestExit");
  zone.entities.push(e);
  handleAfterDialogue(zone, e);
  assert.ok(e._walkAway, "walker stashed");
  assert.ok(e._walkAway.path.length > 0, "non-empty path");
  assert.deepEqual(e._walkAway.path[e._walkAway.path.length - 1], { x: 0, y: 0 },
    "path ends on the teleporter tile");
  assert.ok(zone.entities.includes(e), "still present — it walks first");
});

test("WalkToNearestExit vanishes instantly when no exit is reachable", () => {
  storage._resetStorageForTesting();
  _setCreativeModeForTesting(false);
  const zone = makeZone({ teleporter: false });
  const e = npc("WalkToNearestExit");
  zone.entities.push(e);
  handleAfterDialogue(zone, e);
  assert.ok(!zone.entities.includes(e), "removed with nowhere to walk");
  assert.equal(storage.getValue("item_collected.7"), 1, "collected flag set");
});

test("tickAfterDialogue walks the NPC to the exit and removes it on arrival", () => {
  storage._resetStorageForTesting();
  _setCreativeModeForTesting(false);
  const zone = makeZone({ teleporter: true });
  const e = npc("WalkToNearestExit");
  zone.entities.push(e);
  handleAfterDialogue(zone, e);
  assert.ok(zone.entities.includes(e), "present before walking");
  // Big dt slices traverse the whole path quickly; loop until gone.
  for (let i = 0; i < 50 && zone.entities.includes(e); i++) {
    tickAfterDialogue(zone, 0.5);
  }
  assert.ok(!zone.entities.includes(e), "gone after reaching the exit");
  assert.equal(storage.getValue("item_collected.7"), 1, "collected flag set");
});

test("creative mode is a no-op for every vanish behavior", () => {
  for (const beh of ["Disappear", "VanishSmoke", "VanishTeleport", "WalkToNearestExit"]) {
    storage._resetStorageForTesting();
    _setCreativeModeForTesting(true);
    const zone = makeZone({ teleporter: true });
    const e = npc(beh);
    zone.entities.push(e);
    handleAfterDialogue(zone, e);
    assert.ok(zone.entities.includes(e), `${beh}: NPC stays in creative mode`);
    assert.equal(isDying(e), false, `${beh}: not dying in creative mode`);
    assert.equal(e._walkAway, undefined, `${beh}: no walker in creative mode`);
  }
  _setCreativeModeForTesting(false);
});

test("Nothing leaves the NPC untouched", () => {
  storage._resetStorageForTesting();
  _setCreativeModeForTesting(false);
  const zone = makeZone();
  const e = npc("Nothing");
  zone.entities.push(e);
  handleAfterDialogue(zone, e);
  assert.ok(zone.entities.includes(e), "still present");
});
