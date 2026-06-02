// Entity inspector — pure hit-test + behavior-list integrity. No DOM.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entityAtTile, inspectedEntity, isEntityInspectorOpen, openEntityInspector,
  BEHAVIOR_LABEL,
} from "../js/entityInspector.js";
import { AFTER_DIALOGUE_BEHAVIORS, handleAfterDialogue } from "../js/afterDialogue.js";
import { _setCreativeModeForTesting } from "../js/creativeMode.js";

test("entityAtTile returns the entity whose frame covers the tile", () => {
  const npc = { id: 1, frame: { x: 2, y: 1, w: 1, h: 2 } }; // feet at (2,2)
  const entities = [npc];
  assert.equal(entityAtTile(entities, 2, 1), npc, "covers the head tile");
  assert.equal(entityAtTile(entities, 2, 2), npc, "covers the feet tile");
  assert.equal(entityAtTile(entities, 3, 2), null, "misses to the side");
  assert.equal(entityAtTile(entities, 2, 3), null, "misses below");
});

test("entityAtTile prefers the topmost (last) overlapping entity", () => {
  const under = { id: 1, frame: { x: 0, y: 0, w: 2, h: 2 } };
  const over = { id: 2, frame: { x: 1, y: 1, w: 1, h: 1 } };
  assert.equal(entityAtTile([under, over], 1, 1), over, "later entity wins overlap");
  assert.equal(entityAtTile([under, over], 0, 0), under, "non-overlap still found");
});

test("entityAtTile is null-safe for missing frames / non-arrays", () => {
  assert.equal(entityAtTile(null, 0, 0), null);
  assert.equal(entityAtTile([{ id: 1 }], 0, 0), null, "entity with no frame");
});

test("frames without w/h default to a 1×1 cover", () => {
  const e = { id: 1, frame: { x: 5, y: 5 } };
  assert.equal(entityAtTile([e], 5, 5), e);
  assert.equal(entityAtTile([e], 6, 5), null);
});

test("Nothing is the first / default behavior in the dropdown order", () => {
  assert.equal(AFTER_DIALOGUE_BEHAVIORS[0], "Nothing",
    "Nothing should head the list so the editor's default reads first");
});

test("every dropdown behavior has a human-readable label", () => {
  for (const beh of AFTER_DIALOGUE_BEHAVIORS) {
    assert.ok(BEHAVIOR_LABEL[beh], `${beh} has a label`);
  }
});

test("label map has no stale keys outside the behavior list", () => {
  for (const key of Object.keys(BEHAVIOR_LABEL)) {
    assert.ok(AFTER_DIALOGUE_BEHAVIORS.includes(key),
      `${key} label has no matching behavior`);
  }
});

test("inspector is import-safe without a DOM (open is a no-op, no throw)", () => {
  // The pure node test runner has no `document`; openEntityInspector must
  // bail cleanly so importing this module in tests never explodes.
  assert.equal(typeof document, "undefined");
  assert.doesNotThrow(() => openEntityInspector(
    { id: 1, after_dialogue: "Disappear", frame: { x: 0, y: 0, w: 1, h: 1 } }));
  assert.equal(isEntityInspectorOpen(), false, "stays closed with no DOM");
  assert.equal(inspectedEntity(), null, "no entity tracked with no DOM");
});

test("every listed behavior is understood by handleAfterDialogue", () => {
  // The inspector's dropdown is built from AFTER_DIALOGUE_BEHAVIORS; each
  // value must be a real behavior the runtime handles. Run in creative
  // mode so the call is a guaranteed no-op (no removal / no path-finding)
  // and we're only asserting it doesn't throw on any enum value.
  _setCreativeModeForTesting(true);
  const zone = { entities: [], cols: 3, rows: 3,
    collision: [[false, false, false], [false, false, false], [false, false, false]] };
  for (const beh of AFTER_DIALOGUE_BEHAVIORS) {
    const e = { id: 1, after_dialogue: beh, frame: { x: 1, y: 1, w: 1, h: 1 } };
    assert.doesNotThrow(() => handleAfterDialogue(zone, e), `${beh} handled`);
  }
  _setCreativeModeForTesting(false);
});
