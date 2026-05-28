// End-to-end-ish online co-op flow exercised in-process.
//
// What we drive (host side, real modules):
//   - input pipeline (input.js)
//   - per-player simulation (player.updatePlayer)
//   - pickups (pickups.checkPickup) including the 10× kunai bundle
//   - shooting (shooting.tryShootForSlot + tickShooting)
//   - host snapshot broadcaster (snapshotBroadcaster)
//   - hostGuests bookkeeping (peer.joined wires state.player2)
//
// What we simulate (guest side):
//   - peer.joined / input intents arriving over the wire (via fakeNet.emit)
//   - outbound deltas / event frames captured in fakeNet.sent
//
// Why in-process and not two real WS clients: the relay → wire is already
// covered by tests/server.session.test.js. The bugs called out in
// roadmap.md ("host can't see guests", "guest can't shoot", "guest can't
// pickup") live in the host-side game pipeline, which is what this test
// pins down. Spawning two browsers would test the same code path with
// more moving parts and no extra signal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Tiny window stub so installShooting/installMelee/installInteract can
// call window.addEventListener without throwing. We never dispatch
// keyboard events from the test — action intents go through
// tryShootForSlot directly, the same path hostGuests.dispatchActionForSlot
// uses on a real run.
if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
}

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260528");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260528");
const { installHostGuests, _uninstallHostGuestsForTesting } =
  await import("../js/hostGuests.js?v=20260528");
const {
  installSnapshotBroadcaster,
  stopSnapshotBroadcaster,
  _snapshotForTesting,
  _broadcastDeltaForTesting,
} = await import("../js/snapshotBroadcaster.js?v=20260528");
const { createPlayer, updatePlayer } = await import("../js/player.js?v=20260528");
const { installShooting, tickShooting, tryShootForSlot } = await import("../js/shooting.js?v=20260528");
const { checkPickup } = await import("../js/pickups.js?v=20260528");
const { loadSpeciesData } = await import("../js/species.js?v=20260528");
const { addAmmo, getAmmo, clearInventory } = await import("../js/inventory.js?v=20260528");
const { resetPlayerHealth } = await import("../js/playerHealth.js?v=20260528");
const { setNetworkGuestCount } = await import("../js/coopMode.js?v=20260528");
const { _resetStorageForTesting } = await import("../js/storage.js?v=20260528");
const inputModule = await import("../js/input.js?v=20260528");

// Real species blob from disk — saves us hand-rolling kunai / bundle /
// launcher records and accidentally drifting from the live game's data.
const SPECIES = JSON.parse(readFileSync(new URL("../data/species.json", import.meta.url)));
const KUNAI = 7000;
const KUNAI_BUNDLE_10X = 7001;

function fakeNet() {
  const handlers = new Map();
  const sent = [];
  return {
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
    },
    emit(op, msg) {
      const list = handlers.get(op) || [];
      for (const h of list.slice()) h(msg);
    },
    send(frame) { sent.push(frame); return true; },
    isConnected: () => true,
    connect: () => {},
    close: () => {},
    setSendInterceptor: () => {},
    emitOp: () => {},
    getUuid: () => "uuid-host",
    getUrl: () => "ws://test",
    sent,
    handlers,
  };
}

// Flat zone — every tile walkable, no special objects. Lets the player
// walk in cardinal lines without bumping into geometry. We hand-place a
// bundle at a known tile via state.zone.entities.push so the pickup loop
// has something to bite on.
function makeFlatZone(cols = 20, rows = 20) {
  return {
    id: 9999,
    cols, rows,
    collision: Array.from({ length: rows }, () => Array.from({ length: cols }, () => false)),
    entities: [],
    biome: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)),
    construction: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)),
    biomeCol: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)),
    constructionRow: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)),
    soundtrack: null,
    lightConditions: "Day",
    ephemeralState: false,
    _cutscenesRaw: [],
  };
}

function makeCoopP2(p1, _zone, opts = {}) {
  // Match what main.js's makeCoopP2 actually does — but minus the
  // facing-direction spawn search (we want a deterministic tile for the
  // assertions below).
  const p2 = createPlayer({ index: opts.index ?? 1 });
  p2.tileX = p1.tileX + 1;
  p2.tileY = p1.tileY;
  p2.x = p2.tileX;
  p2.y = p2.tileY;
  p2.direction = "down";
  return p2;
}

// Single tick step — drives input pipeline → updatePlayer for every slot
// → pickups → bullets. dt small enough to honour STEP_DURATION (~0.22s)
// in tile-by-tile resolution.
function tick(state, dt = 0.02) {
  const input1 = inputModule.pollInput(1);
  updatePlayer(state.player, input1, dt, state.zone);
  if (state.player2) {
    const input2 = inputModule.pollInput(2);
    updatePlayer(state.player2, input2, dt, state.zone);
  }
  for (const s of state.players) {
    const inputN = inputModule.pollInput(s.slot);
    updatePlayer(s.player, inputN, dt, state.zone);
  }
  checkPickup(state);
  tickShooting(dt);
}

// Drives `frames` ticks of `dt` each — coarse-grained way to let the
// step-locked motion finish. STEP_DURATION is 0.22 s; @ dt=0.02 that's
// ~11 ticks per tile so 20 ticks comfortably resolves one tile-step.
function tickN(state, frames, dt = 0.02) {
  for (let i = 0; i < frames; i++) tick(state, dt);
}

// Holds an intent for exactly enough ticks for `tiles` tile-steps, then
// releases (stopMove) and lets the final in-flight step snap onto its
// target tile WITHOUT chaining a new one. Key invariant: stopMove must
// arrive *before* the Nth snap tick — the chain branch in advanceStep
// reads input.held at snap time and starts a new step if anything is
// held. Clearing held first means the Nth snap is the last.
//
// Tile timing: STEP_DURATION = 0.22 s, dt = 0.02 s → 11 advances + 1
// startStep tick per tile (first tile only); chained tiles take 11
// ticks each (the snap+create-next happens in the same tick). With
// a direction change, ROTATE_COMMIT_DELAY adds 3 more ticks before
// the first step is committed.
let seqCounter = 1;
function walkIntent(state, fn, fromId, intent, tiles, dt = 0.02) {
  const dir = intent.startsWith("move") ? intent.slice(4).toLowerCase() : null;
  // Slot lookup — tests so far only drive the slot-2 guest, but keep
  // this generic so future variations can wire slot 3/4.
  const target = (state.player2?.playerId === fromId)
    ? state.player2
    : (state.players.find((s) => s.playerId === fromId)?.player ?? null);
  const willRotate = !!(target && dir && target.direction !== dir);
  const rotateBudget = willRotate ? 3 : 0;
  fn.emit("input", { op: "input", seq: seqCounter++, from: fromId, intent });
  // tiles * 11 + rotateBudget ticks: lands the avatar mid-Nth-step.
  // stopMove then arrives between the (N-1)th snap and the Nth snap,
  // so the Nth advance sees held=empty and idles after the snap.
  tickN(state, tiles * 11 + rotateBudget, dt);
  fn.emit("input", { op: "input", seq: seqCounter++, from: fromId, intent: "stopMove" });
  tickN(state, 3, dt);
}

function setupHostWorld({ bundleAt = { x: 5, y: 8 } } = {}) {
  // Module-level singletons — clear before each test.
  _resetOnlineBootstrapForTesting();
  _uninstallHostGuestsForTesting();
  stopSnapshotBroadcaster();
  for (const s of [1, 2, 3, 4]) inputModule.clearInputState(s);
  setNetworkGuestCount(0);
  resetPlayerHealth();
  clearInventory();
  // Storage holds `item_collected.<id>` flags; without wiping, a bundle
  // picked up in test A would be invisible (shouldBeVisible → false) in
  // test B, and the second test's pickup would silently no-op.
  _resetStorageForTesting();
  // Load real species data so the kunai bundle / kunai launcher / bullet
  // lookups in pickups.js + shooting.js have their real metadata.
  loadSpeciesData(SPECIES);

  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host" });

  const zone = makeFlatZone(20, 20);
  // 10× kunai bundle at the configured tile. id ≥ 1 so pickups.js can
  // stamp item_collected.<id> in storage (we wipe storage between tests
  // via clearInventory's path, but the entity itself is fresh per test
  // so the flag never matters here).
  zone.entities.push({
    id: 4242,
    species_id: KUNAI_BUNDLE_10X,
    frame: { x: bundleAt.x, y: bundleAt.y, w: 1, h: 1 },
    is_consumable: true,
  });

  const player = createPlayer();
  player.tileX = 5; player.tileY = 5;
  player.x = 5; player.y = 5;
  player.direction = "down";

  const state = {
    zone,
    player,
    player2: null,
    players: [],
    lastTile: { x: 5, y: 5 },
    lastTile2: null,
  };

  const fn = fakeNet();
  bootstrapOnline({ netFactory: () => fn });
  // welcome seeds selfPlayerId for the broadcaster (without it,
  // playersOf() drops the host because the playerId is null).
  fn.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Host" });
  installShooting(() => state);
  installHostGuests(() => state, { makeCoopP2, net: fn });
  installSnapshotBroadcaster(() => state, { net: fn, intervalMs: 1_000_000 }); // dont auto-tick
  return { state, fn };
}

function teardown() {
  stopSnapshotBroadcaster();
  _uninstallHostGuestsForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  for (const s of [1, 2, 3, 4]) inputModule.clearInputState(s);
  setNetworkGuestCount(0);
  resetPlayerHealth();
  clearInventory();
}

// --- 1. host can see the guest ----------------------------------------------
//
// Regression for "When in online co-op the hosts cannot see guests".
// hostGuests spawns state.player2 on peer.joined; the broadcaster's
// playersOf() must include it; main.js's render must accept it. Pin the
// first link in that chain (broadcaster includes state.player2 once the
// guest joined) — main.js wiring is covered separately by reading
// allPlayers(state) which is what livePlayersForRender returns.

test("E2E: peer.joined makes state.player2 appear in the host's outgoing snapshot", () => {
  const { state, fn } = setupHostWorld();
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });
    assert.ok(state.player2, "state.player2 must exist after peer.joined");
    assert.equal(state.player2.playerId, "p_guest");

    const snap = _snapshotForTesting(state);
    const pids = snap.players.map((p) => p.playerId).sort();
    assert.deepEqual(pids, ["p_guest", "p_host"]);
  } finally { teardown(); }
});

// Regression for "guest's own avatar is briefly invisible after connect".
// Both hostGuests and snapshotBroadcaster listen on `peer.joined`. The
// broadcaster's handler ships a snapshot; hostGuests's handler spawns
// the guest in state. net dispatches handlers in registration order, so
// if hostGuests is installed AFTER the broadcaster the snapshot fans
// out before the guest exists in state — its mirror has no entry for
// itself, predictedSelf can't be built, and the local avatar stays
// invisible until the next delta (~50 ms). switchRole pins the order
// to hostGuests-first; this test catches a swap-back.
test("E2E: snapshot sent in response to peer.joined includes the joining guest", () => {
  const { fn } = setupHostWorld();
  try {
    const sentBefore = fn.sent.length;
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });
    const snap = fn.sent.slice(sentBefore).find((f) => f.op === "snapshot");
    assert.ok(snap, "broadcaster must send a snapshot on peer.joined");
    const pids = snap.players.map((p) => p.playerId).sort();
    assert.deepEqual(pids, ["p_guest", "p_host"],
      "snapshot sent in the same peer.joined dispatch must include the joining guest");
  } finally { teardown(); }
});

// --- 2. guest walks down onto the 10× kunai bundle --------------------------
//
// Step-by-step: send moveDown intents at the start of each tile and
// repeat until state.player2 lands on the bundle. The host's pickup loop
// then resolves the bundle and credits 10 kunai into the picker's own
// inventory slot — per-player in network co-op (effectiveIndex only
// folds for isCoopMode, not network). The matching event:pickup frame
// goes onto the wire tagged with the picker's playerId so only that
// guest's HUD ticks up; other clients ignore the pickup payload.

test("E2E: guest walks down onto a 10× kunai bundle → host credits 10 kunai to slot 1 + broadcasts event:pickup", () => {
  const { state, fn } = setupHostWorld({ bundleAt: { x: 6, y: 8 } });
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });
    // makeCoopP2 spawns the guest one tile east of P1 → (6, 5). Bundle
    // is at (6, 8), so the guest must take 3 down-steps.
    assert.deepEqual(
      { x: state.player2.tileX, y: state.player2.tileY },
      { x: 6, y: 5 },
    );

    const ammoBefore = getAmmo(KUNAI, 1);

    // Hold moveDown for 3 tile-steps — the avatar's chained stepping
    // (HOLD_PRIORITY) walks tile-by-tile while the key is held.
    walkIntent(state, fn, "p_guest", "moveDown", 3);

    assert.equal(
      state.player2.tileY, 8,
      `guest must walk to y=8 (got ${state.player2.tileY})`,
    );
    assert.equal(
      getAmmo(KUNAI, 1), ammoBefore + 10,
      "10× kunai bundle should credit exactly 10 to the picker's slot (index 1)",
    );
    assert.equal(
      getAmmo(KUNAI, 0), 0,
      "host's own ammo pool must not change when the guest picks up",
    );

    const pickupFrames = fn.sent.filter((f) => f.op === "event" && f.kind === "pickup");
    assert.equal(pickupFrames.length, 1, "exactly one event:pickup should fan out");
    assert.equal(pickupFrames[0].playerId, "p_guest", "pickup event must be tagged with the picker's playerId");
    const total = pickupFrames[0].items.reduce((acc, it) => acc + (it.amount | 0), 0);
    assert.equal(total, 10, "broadcast payload should sum to 10");

    // And the bundle itself must be gone from the zone — otherwise the
    // guest's next tick would re-pick it up.
    const bundleStillThere = state.zone.entities.find((e) => e.id === 4242);
    assert.equal(bundleStillThere, undefined, "bundle entity must be removed after pickup");
  } finally { teardown(); }
});

// --- 3. guest walks back up -------------------------------------------------
//
// After collecting the bundle, the guest should be able to walk back to
// their spawn tile (proves the avatar is fully reactive to repeated
// direction changes, not stuck in a moveDown lock).

test("E2E: after pickup the guest can reverse direction and walk back up", () => {
  const { state, fn } = setupHostWorld({ bundleAt: { x: 6, y: 8 } });
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });

    walkIntent(state, fn, "p_guest", "moveDown", 3);
    assert.equal(state.player2.tileY, 8);

    walkIntent(state, fn, "p_guest", "moveUp", 3);
    assert.equal(state.player2.tileY, 5, "guest must return to y=5");
    assert.equal(state.player2.direction, "up", "facing direction should be up after the back-walk");
  } finally { teardown(); }
});

// --- 4. guest fires a kunai -------------------------------------------------
//
// With 10 kunai picked up, a single "shoot" intent should consume one
// ammo and spawn a bullet in state.zone.entities. The bullet inherits
// the guest's facing direction and is tagged _spawned so pickups don't
// auto-collect it.

test("E2E: shoot intent from the guest spawns a bullet at the guest's tile and decrements ammo", () => {
  const { state, fn } = setupHostWorld({ bundleAt: { x: 6, y: 8 } });
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });

    walkIntent(state, fn, "p_guest", "moveDown", 3);
    assert.equal(getAmmo(KUNAI, 1), 10, "precondition: 10 kunai available in the guest's slot");
    const expectedDir = "down";
    assert.equal(state.player2.direction, expectedDir);

    const entitiesBefore = state.zone.entities.length;

    fn.emit("input", { op: "input", seq: 500, from: "p_guest", intent: "shoot" });
    // No tick needed — host's onInput dispatch is synchronous through
    // tryShootForSlot, which immediately mutates state.zone.entities.

    assert.equal(getAmmo(KUNAI, 1), 9, "shoot must consume one kunai from the guest's slot");
    assert.equal(
      state.zone.entities.length, entitiesBefore + 1,
      "shoot must spawn exactly one new entity",
    );
    const bullet = state.zone.entities[state.zone.entities.length - 1];
    assert.equal(bullet._spawned, true, "spawned bullet must carry _spawned so pickups skip it");
    assert.equal(bullet.species_id, KUNAI);
    assert.equal(bullet._playerIndex, 1, "bullet must remember it came from slot-2 (index 1)");
    assert.equal(bullet.direction, "Down");
  } finally { teardown(); }
});

// --- 5. broadcaster delta carries the guest after they move ---------------
//
// Companion to test #1 — pin that subsequent deltas (not just the
// snapshot) include state.player2 once it has changed. _broadcastDelta
// only sends entries whose signature changed since the last delta, so
// the guest's tile change must drive a non-empty players[] in the delta.

test("E2E: after the guest steps, the host's outgoing delta includes the guest's new tile", () => {
  const { state, fn } = setupHostWorld();
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });
    // Seed the broadcaster's sig cache with a snapshot, otherwise the
    // first delta would re-publish every player as "changed".
    _snapshotForTesting(state);

    walkIntent(state, fn, "p_guest", "moveDown", 1);

    const delta = _broadcastDeltaForTesting(fn, state);
    assert.ok(delta, "expected a non-empty delta after guest movement");
    const guestEntry = (delta.players || []).find((p) => p.playerId === "p_guest");
    assert.ok(guestEntry, "delta.players must contain the guest");
    assert.equal(guestEntry.tileY, 6, "delta must carry the guest's new tile y");
  } finally { teardown(); }
});

// --- 6. lastSeq feedback to the guest --------------------------------------
//
// Reconciliation on the guest side reads delta.lastSeq[selfId] to drop
// acked inputs. Pin that the highest seq the host has applied for the
// guest comes back in subsequent deltas.

test("E2E: outgoing snapshot reflects the highest seq the host has applied for the guest", () => {
  const { state, fn } = setupHostWorld();
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });
    fn.emit("input", { op: "input", seq: 7, from: "p_guest", intent: "moveDown" });
    fn.emit("input", { op: "input", seq: 8, from: "p_guest", intent: "stopMove" });

    const snap = _snapshotForTesting(state);
    assert.equal(snap.lastSeq["p_guest"], 8);
  } finally { teardown(); }
});
