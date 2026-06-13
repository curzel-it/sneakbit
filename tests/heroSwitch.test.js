// Ownership model for the Tower Defense squad: which input slot drives which
// hero, switching to free heroes, and the solo special case (one owner cycling
// through every living hero). Pure logic — no DOM, no camera.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resetHeroSwitch, ownedHeroFor, ownerSlotOf, setOwnership, releaseSlot,
  ownerSlots, squadPlayers, ownedHeroPlayer, freeHeroes, switchHeroForSlot,
  ensureLiveOwner, cameraTargetFor, getActiveHeroIndex, activeHero,
} from "../js/heroSwitch.js";

// A squad of n heroes laid out exactly where co-op players live: P1 in
// state.player, P2 in state.player2, the rest in state.players[].
function makeSquad(n) {
  const mk = (i) => ({ index: i, tileX: i, tileY: 0 });
  const state = { player: mk(0) };
  if (n >= 2) state.player2 = mk(1);
  state.players = [];
  for (let i = 2; i < n; i++) state.players.push({ player: mk(i), slot: i + 1 });
  return state;
}

// isDead injector backed by a Set of dead hero indices.
const deadSet = (...idx) => { const s = new Set(idx); return (i) => s.has(i | 0); };
const noneDead = () => false;

test("resetHeroSwitch(1): slot 1 owns hero 0, the rest are free", () => {
  resetHeroSwitch(1);
  const state = makeSquad(3);
  assert.equal(ownedHeroFor(1), 0);
  assert.equal(ownerSlotOf(0), 1);
  assert.equal(ownerSlotOf(1), null);
  assert.equal(ownerSlotOf(2), null);
  assert.deepEqual(freeHeroes(state).map((p) => p.index), [1, 2]);
  assert.deepEqual(ownerSlots(), [1]);
});

test("resetHeroSwitch(N): slot s drives hero s-1", () => {
  resetHeroSwitch(3);
  assert.equal(ownedHeroFor(1), 0);
  assert.equal(ownedHeroFor(2), 1);
  assert.equal(ownedHeroFor(3), 2);
  assert.deepEqual(ownerSlots(), [1, 2, 3]);
});

test("solo switching cycles through every living hero, wrapping", () => {
  resetHeroSwitch(1);
  const state = makeSquad(3);
  assert.equal(switchHeroForSlot(state, 1, noneDead), 1);
  assert.equal(switchHeroForSlot(state, 1, noneDead), 2);
  assert.equal(switchHeroForSlot(state, 1, noneDead), 0); // wraps
  // The released hero reverts to free; only the current is owned.
  assert.equal(ownerSlotOf(1), null);
  assert.equal(ownerSlotOf(2), null);
  assert.equal(ownerSlotOf(0), 1);
});

test("switching skips dead heroes", () => {
  resetHeroSwitch(1);
  const state = makeSquad(3);
  assert.equal(switchHeroForSlot(state, 1, deadSet(1)), 2); // 0 -> (skip 1) -> 2
});

test("heroes == players: switching is a no-op (no free heroes)", () => {
  resetHeroSwitch(2);
  const state = makeSquad(2);
  assert.equal(switchHeroForSlot(state, 1, noneDead), 0);
  assert.equal(switchHeroForSlot(state, 2, noneDead), 1);
  assert.equal(ownedHeroFor(1), 0);
  assert.equal(ownedHeroFor(2), 1);
});

test("a player only grabs free heroes, never one another slot owns", () => {
  resetHeroSwitch(2);      // slot1->0, slot2->1
  const state = makeSquad(3); // hero 2 is free
  assert.equal(switchHeroForSlot(state, 1, noneDead), 2); // grabs the free one
  assert.equal(ownerSlotOf(0), null); // released
  assert.equal(ownerSlotOf(2), 1);
  assert.equal(ownedHeroFor(2), 1);   // slot 2 untouched
});

test("ensureLiveOwner hands a slot off its corpse to a free living hero", () => {
  resetHeroSwitch(1);
  const state = makeSquad(2);
  assert.equal(ensureLiveOwner(state, 1, deadSet(0)), true);
  assert.equal(ownedHeroFor(1), 1);
});

test("ensureLiveOwner keeps a slot on its dead hero when none are free/living", () => {
  resetHeroSwitch(1);
  const state = makeSquad(2);
  // Both heroes dead → nothing to switch to; the slot waits for a revive.
  assert.equal(ensureLiveOwner(state, 1, deadSet(0, 1)), false);
  assert.equal(ownedHeroFor(1), 0);
});

test("ensureLiveOwner is a no-op when the owned hero is alive", () => {
  resetHeroSwitch(1);
  const state = makeSquad(2);
  assert.equal(ensureLiveOwner(state, 1, noneDead), false);
  assert.equal(ownedHeroFor(1), 0);
});

test("setOwnership / releaseSlot assign and free a slot", () => {
  resetHeroSwitch(1);
  setOwnership(2, 1);
  assert.equal(ownedHeroFor(2), 1);
  assert.equal(ownerSlotOf(1), 2);
  setOwnership(2, null);
  assert.equal(ownedHeroFor(2), null);
  setOwnership(2, 1);
  releaseSlot(2);
  assert.equal(ownedHeroFor(2), null);
});

test("ownedHeroPlayer and cameraTargetFor resolve to the player object", () => {
  resetHeroSwitch(2);
  const state = makeSquad(2);
  assert.equal(ownedHeroPlayer(state, 1), state.player);
  assert.equal(ownedHeroPlayer(state, 2), state.player2);
  assert.equal(cameraTargetFor(state, 2), state.player2);
  // An unowned slot falls back to P1 for the camera.
  assert.equal(cameraTargetFor(state, 4), state.player);
});

test("solo conveniences track slot 1", () => {
  resetHeroSwitch(1);
  const state = makeSquad(2);
  assert.equal(getActiveHeroIndex(), 0);
  assert.equal(activeHero(state), state.player);
  switchHeroForSlot(state, 1, noneDead);
  assert.equal(getActiveHeroIndex(), 1);
  assert.equal(activeHero(state), state.player2);
});

test("squadPlayers returns heroes in slot order", () => {
  const state = makeSquad(4);
  assert.deepEqual(squadPlayers(state).map((p) => p.index), [0, 1, 2, 3]);
});
