import { test } from "node:test";
import {
  performMeleeSwing,
  getMeleeSwingProgress,
  tickMelee,
  predictGuestSwing,
} from "../js/melee.js?v=20260531b";
import assert from "node:assert/strict";

let speciesLoaded = false;
async function ensureSpecies() {
  if (speciesLoaded) return;
  const { loadSpeciesData } = await import("../js/species.js?v=20260531b");
  await loadSpeciesData();
  speciesLoaded = true;
}

function makeState(playerOverrides = {}) {
  return {
    player: {
      index: 0,
      tileX: 5,
      tileY: 5,
      direction: "down",
      ...playerOverrides,
    },
    zone: { entities: [], cols: 20, rows: 20 },
  };
}

test("performMeleeSwing spawns five bullets in a cross pattern", async () => {
  await ensureSpecies();
  const state = makeState();
  performMeleeSwing(state);
  const bullets = state.zone.entities.filter((e) => e._spawned);
  assert.equal(bullets.length, 5);
});

test("performMeleeSwing respects cooldown (no double swing)", async () => {
  await ensureSpecies();
  const state = makeState();
  performMeleeSwing(state);
  const firstCount = state.zone.entities.length;
  performMeleeSwing(state);
  assert.equal(state.zone.entities.length, firstCount);
});

test("getMeleeSwingProgress returns null when not swinging", async () => {
  await ensureSpecies();
  makeState();
  assert.equal(getMeleeSwingProgress(1), null);
});

test("getMeleeSwingProgress tracks the active swing", async () => {
  await ensureSpecies();
  const state = makeState();
  performMeleeSwing(state);
  const p = getMeleeSwingProgress(0);
  assert.ok(p > 0 && p <= 1);
});

test("tickMelee decays the swing cooldown", async () => {
  await ensureSpecies();
  const state = makeState();
  performMeleeSwing(state);
  tickMelee(1.0);
  assert.equal(getMeleeSwingProgress(0), null);
});

test("performMeleeSwing is a no-op when no weapon equipped", async () => {
  await ensureSpecies();
  // index 99 has no loadout → resolveLoadout returns empty → no bullets
  const state99 = makeState({ index: 99 });
  performMeleeSwing(state99);
  const bullets = state99.zone.entities.filter((e) => e._spawned);
  assert.equal(bullets.length, 0);
});

test("performMeleeSwing uses the player's facing direction", async () => {
  await ensureSpecies();
  const state = makeState();
  performMeleeSwing(state);
  const bullets = state.zone.entities.filter((e) => e._spawned);
  assert.equal(bullets.length, 5);
});

// Guest-side prediction: arms the swing animation (so the guest sees its own
// swing instantly) WITHOUT spawning bullets — the host owns the authoritative
// hit. See predictGuestShoot/predictGuestSwing in the netcode latency model.
test("predictGuestSwing animates the swing but spawns no bullets", async () => {
  await ensureSpecies();
  const state = makeState({ index: 2 });
  tickMelee(10_000); // drain any prior cooldown for index 2 → idle
  predictGuestSwing(state.player);
  assert.ok(getMeleeSwingProgress(2) !== null, "swing should be animating");
  const bullets = state.zone.entities.filter((e) => e._spawned);
  assert.equal(bullets.length, 0, "prediction must not spawn authoritative bullets");
});

test("predictGuestSwing is a no-op with no melee weapon equipped", async () => {
  await ensureSpecies();
  tickMelee(10_000); // drain index 99 → idle
  predictGuestSwing({ index: 99, tileX: 5, tileY: 5, direction: "down" });
  assert.equal(getMeleeSwingProgress(99), null, "no weapon → no swing");
});
