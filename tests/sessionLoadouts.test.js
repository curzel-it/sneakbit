// resolveLoadout is the seam every renderer and combat path should
// route through; it prefers the per-playerId session entry and falls
// back to local equipment by index when there's no session data.

import { test } from "node:test";
import assert from "node:assert/strict";

const equipment = await import("../js/equipment.js?v=20260530d");
const storage = await import("../js/storage.js?v=20260530d");
const {
  setSessionLoadout,
  getSessionLoadout,
  deleteSessionLoadout,
  resolveLoadout,
  _resetSessionLoadoutsForTesting,
} = await import("../js/sessionLoadouts.js?v=20260530d");

function reset() {
  storage._resetStorageForTesting();
  _resetSessionLoadoutsForTesting();
}

test("resolveLoadout prefers the session entry when playerId is set", () => {
  reset();
  setSessionLoadout("p_guest", 1159, 1160);
  const out = resolveLoadout({ playerId: "p_guest", index: 1 });
  assert.equal(out.melee, 1159);
  assert.equal(out.ranged, 1160);
});

test("resolveLoadout falls back to getEquipped when no session entry", () => {
  reset();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159, 0);
  const out = resolveLoadout({ playerId: "p_unknown", index: 0 });
  assert.equal(out.melee, 1159);
  // SLOT_RANGED defaults to kunai launcher 1160 (see equipment.js).
  assert.equal(out.ranged, equipment.DEFAULT_RANGED_WEAPON_ID);
});

test("resolveLoadout works without a playerId (offline / local-coop callers)", () => {
  reset();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159, 0);
  const out = resolveLoadout({ index: 0 });
  assert.equal(out.melee, 1159);
});

test("resolveLoadout returns nulls for an empty player object", () => {
  reset();
  const out = resolveLoadout(null);
  assert.equal(out.melee, null);
  assert.equal(out.ranged, null);
});

test("deleteSessionLoadout drops the entry so subsequent resolves fall back", () => {
  reset();
  setSessionLoadout("p_guest", 1159, 1160);
  assert.ok(getSessionLoadout("p_guest"));
  deleteSessionLoadout("p_guest");
  assert.equal(getSessionLoadout("p_guest"), null);
  // Falls through to getEquipped(SLOT_MELEE, 1) — empty by default.
  const out = resolveLoadout({ playerId: "p_guest", index: 1 });
  assert.equal(out.melee, null);
});
