// Slot → hero resolution. The regression this guards: slot 2 used to be
// refused unless state.player2 carried a network playerId, which silently
// disabled a local co-op P2's controller (shoot / melee / interact all
// resolved to nobody, so the second player could carry a sword and never
// swing it).

import { test } from "node:test";
import assert from "node:assert/strict";

import { playerForSlot } from "../js/playerSlots.js";

function makeState({ p2 = null, extras = [] } = {}) {
  return {
    player: { index: 0, tag: "p1" },
    player2: p2,
    players: extras,
  };
}

test("slot 1 is always the local player", () => {
  const state = makeState();
  assert.equal(playerForSlot(state, 1), state.player);
});

test("slot 2 resolves a local co-op P2 that carries no playerId", () => {
  const p2 = { index: 1, tag: "local-p2" };
  const state = makeState({ p2 });
  assert.equal(playerForSlot(state, 2), p2);
});

test("slot 2 resolves an online guest avatar too", () => {
  const p2 = { index: 1, playerId: "guest-abc" };
  const state = makeState({ p2 });
  assert.equal(playerForSlot(state, 2), p2);
});

test("slots 3 and 4 come from state.players, matched by slot", () => {
  const p3 = { index: 2 };
  const p4 = { index: 3 };
  const state = makeState({
    extras: [
      { player: p4, slot: 4, playerId: null },
      { player: p3, slot: 3, playerId: "guest-xyz" },
    ],
  });
  assert.equal(playerForSlot(state, 3), p3);
  assert.equal(playerForSlot(state, 4), p4);
});

test("an unfilled slot (or no state at all) resolves to null", () => {
  assert.equal(playerForSlot(makeState(), 2), null);
  assert.equal(playerForSlot(makeState(), 3), null);
  assert.equal(playerForSlot(makeState(), 5), null);
  assert.equal(playerForSlot(null, 1), null);
});
