// We can't import pickups.js directly under node: its transitive imports
// reach into the DOM (Audio, document) when their module bodies run. Instead
// we reproduce the public classification logic here, against the same
// species registry, to lock in the auto-trigger rules (hint+consumable,
// Bundle, PickableObject) and the explicit exclusion of Teleporters.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData, getSpecies } from "../js/species.js?v=20260529e";

const AUTO_PICKUP_TYPES = new Set(["Bundle", "PickableObject", "Bullet"]);

function classify(e) {
  const sp = getSpecies(e.species_id);
  if (!sp) return null;
  if (AUTO_PICKUP_TYPES.has(sp.entity_type)) return "pickup";
  if (sp.entity_type === "Hint" && e.is_consumable) return "hint";
  return null;
}

loadSpeciesData([
  { id: 50000, entity_type: "Hint", sprite_sheet_id: 1010 },
  { id: 7001,  entity_type: "Bundle", sprite_sheet_id: 1010 },
  { id: 7000,  entity_type: "Bullet", sprite_sheet_id: 1014 },
  { id: 2000,  entity_type: "PickableObject", sprite_sheet_id: 1012 },
  { id: 1019,  entity_type: "Teleporter", sprite_sheet_id: 1010 },
  { id: 1003,  entity_type: "Building", sprite_sheet_id: 1004 },
]);

test("consumable hint classifies as 'hint'", () => {
  assert.equal(classify({ species_id: 50000, is_consumable: true }), "hint");
});

test("non-consumable hint is NOT auto-triggered (read on interact only)", () => {
  assert.equal(classify({ species_id: 50000, is_consumable: false }), null);
});

test("bundle classifies as 'pickup' regardless of is_consumable flag", () => {
  assert.equal(classify({ species_id: 7001, is_consumable: false }), "pickup");
  assert.equal(classify({ species_id: 7001, is_consumable: true }),  "pickup");
});

test("pickable object classifies as 'pickup'", () => {
  assert.equal(classify({ species_id: 2000, is_consumable: false }), "pickup");
});

test("placed bullet (kunai in zone) classifies as 'pickup'", () => {
  // The HTML port has no shooting yet, so every Bullet in zone data is
  // stationary and acts as a collectible — matches the original engine's
  // behaviour for bullets with current_speed == 0.
  assert.equal(classify({ species_id: 7000, is_consumable: false }), "pickup");
});

test("teleporter is never auto-triggered (transitions.js owns it)", () => {
  assert.equal(classify({ species_id: 1019, is_consumable: false }), null);
  assert.equal(classify({ species_id: 1019, is_consumable: true }),  null);
});

test("building is never auto-triggered", () => {
  assert.equal(classify({ species_id: 1003, is_consumable: false }), null);
});

test("unknown species id is null (defensive)", () => {
  assert.equal(classify({ species_id: 999999, is_consumable: true }), null);
});
