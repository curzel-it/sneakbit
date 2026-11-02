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
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const { installHostGuests, _uninstallHostGuestsForTesting } =
  await import("../js/hostGuests.js");
const {
  installSnapshotBroadcaster,
  stopSnapshotBroadcaster,
  _snapshotForTesting,
  _broadcastDeltaForTesting,
} = await import("../js/snapshotBroadcaster.js");
const { createPlayer, updatePlayer, updateGuestAvatar } = await import("../js/player.js");
const { getLastSeqMap } = await import("../js/hostGuests.js");
const { installShooting, tickShooting, tryShootForSlot } = await import("../js/shooting.js");
const { checkPickup } = await import("../js/pickups.js");
const { loadSpeciesData } = await import("../js/species.js");
const { addAmmo, getAmmo, clearInventory } = await import("../js/inventory.js");
const { resetPlayerHealth } = await import("../js/playerHealth.js");
const { setNetworkGuestCount } = await import("../js/coopMode.js");
const { _resetStorageForTesting } = await import("../js/storage.js");
const inputModule = await import("../js/input.js");

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

// Single tick step — animates guest avatars (updateGuestAvatar) + the host
// avatar (updatePlayer) → pickups → bullets. dt small enough to honour
// STEP_DURATION (~0.22s) in tile-by-tile resolution.
function tick(state, dt = 0.02) {
  const input1 = inputModule.pollInput(1);
  updatePlayer(state.player, input1, dt, state.zone);
  if (state.player2) {
    if (state.player2.playerId) updateGuestAvatar(state.player2, dt, state.zone);
    else updatePlayer(state.player2, inputModule.pollInput(2), dt, state.zone);
  }
  for (const s of state.players) {
    if (s.playerId) updateGuestAvatar(s.player, dt, state.zone);
    else updatePlayer(s.player, inputModule.pollInput(s.slot), dt, state.zone);
  }
  checkPickup(state);
  tickShooting(dt);
}

const DIR_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function avatarFor(state, fromId) {
  if (state.player2?.playerId === fromId) return state.player2;
  return state.players.find((s) => s.playerId === fromId)?.player ?? null;
}

// Walk a guest `tiles` tiles in `dir` by streaming position updates in
// small increments, exactly what predictedSelf does on a real guest, ticking
// the host between updates so pickups resolve as the avatar crosses tiles.
let seqCounter = 1;
const WALK_INCREMENT = 0.1;
function walk(state, fn, fromId, dir, tiles, dt = 0.02) {
  const a = avatarFor(state, fromId);
  const [dx, dy] = DIR_DELTA[dir];
  const sx = a.x, sy = a.y;
  const n = Math.round(tiles / WALK_INCREMENT);
  for (let i = 1; i <= n; i++) {
    const x = Math.round((sx + dx * WALK_INCREMENT * i) * 1000) / 1000;
    const y = Math.round((sy + dy * WALK_INCREMENT * i) * 1000) / 1000;
    fn.emit("move", { op: "move", seq: seqCounter++, from: fromId, k: "pos", x, y, d: dir, m: i < n ? 1 : 0 });
    tick(state, dt);
  }
  tick(state, dt);
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
// inventory slot — every player owns a dedicated inventory (indices are
// never folded together). The matching event:pickup frame
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

    walk(state, fn, "p_guest", "down", 3);

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

    walk(state, fn, "p_guest", "down", 3);
    assert.equal(state.player2.tileY, 8);

    walk(state, fn, "p_guest", "up", 3);
    assert.equal(state.player2.tileY, 5, "guest must return to y=5");
    assert.equal(state.player2.direction, "up", "facing direction should be up after the back-walk");
  } finally { teardown(); }
});

// --- 4. guest fires a kunai -------------------------------------------------
//
// With the starter kit's 10 kunai plus the 10 picked up, a single "shoot" intent should consume one
// ammo and spawn a bullet in state.zone.entities. The bullet inherits
// the guest's facing direction and is tagged _spawned so pickups don't
// auto-collect it.

test("E2E: shoot intent from the guest spawns a bullet at the guest's tile and decrements ammo", () => {
  const { state, fn } = setupHostWorld({ bundleAt: { x: 6, y: 8 } });
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });

    walk(state, fn, "p_guest", "down", 3);
    assert.equal(getAmmo(KUNAI, 1), 20, "precondition: starter 10 + bundle 10 kunai in the guest's slot");
    const expectedDir = "down";
    assert.equal(state.player2.direction, expectedDir);

    const entitiesBefore = state.zone.entities.length;

    fn.emit("input", { op: "input", seq: 500, from: "p_guest", intent: "shoot" });
    // No tick needed — host's onInput dispatch is synchronous through
    // tryShootForSlot, which immediately mutates state.zone.entities.

    assert.equal(getAmmo(KUNAI, 1), 19, "shoot must consume one kunai from the guest's slot");
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

    walk(state, fn, "p_guest", "down", 1);

    const delta = _broadcastDeltaForTesting(fn, state);
    assert.ok(delta, "expected a non-empty delta after guest movement");
    const guestEntry = (delta.players || []).find((p) => p.playerId === "p_guest");
    assert.ok(guestEntry, "delta.players must contain the guest");
    assert.equal(guestEntry.tileY, 6, "delta must carry the guest's new tile y");
  } finally { teardown(); }
});

// --- 6. lastSeq feedback to the guest --------------------------------------
//
// Reconciliation on the guest side reads delta.lastSeq[selfId] to anchor its
// position log. Pin that an applied update's seq comes back in the outgoing
// snapshot together with the position it produced.

test("E2E: outgoing snapshot pairs the guest's latest update seq with its position", () => {
  const { state, fn } = setupHostWorld();
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest", slot: 2 });
    const a = state.player2;
    fn.emit("move", { op: "move", seq: 42, from: "p_guest", k: "pos", x: a.x, y: a.y + 0.3, d: "down", m: 1 });
    const snap = _snapshotForTesting(state);
    assert.equal(snap.lastSeq["p_guest"], 42);
    const guest = snap.players.find((p) => p.playerId === "p_guest");
    assert.equal(guest.y, 5.3);
  } finally { teardown(); }
});

// --- 7. a zone change must not strand the guest ------------------------------
//
// travelTo / respawn place a guest avatar on a new spot. Updates the guest
// sent from its old spot are rejected (too far), and the first update from
// the new spot (after the snapshot snaps the guest) is accepted.

test("E2E: after a teleport, stale updates bounce and the guest walks on from the new spot", () => {
  const { state, fn } = setupHostWorld();
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest3", slot: 3 });
    const a = avatarFor(state, "p_guest3");
    const sx = a.x, sy = a.y;

    // What transitions.movePlayerTo does to every co-op avatar on zone entry.
    a.tileX = 15; a.tileY = 15; a.x = 15; a.y = 15;

    fn.emit("move", { op: "move", seq: 100, from: "p_guest3", k: "pos", x: sx, y: sy + 0.2, d: "down", m: 1 });
    assert.deepEqual([a.x, a.y], [15, 15], "a stale update from the old spot is rejected");
    assert.equal(getLastSeqMap()["p_guest3"], 100, "and acked so the guest reconciles");

    fn.emit("move", { op: "move", seq: 101, from: "p_guest3", k: "pos", x: 15.2, y: 15, d: "right", m: 1 });
    assert.deepEqual([a.x, a.y], [15.2, 15]);
  } finally { teardown(); }
});

test("E2E: an update into a wall is rejected and the guest walks on from where it stands", () => {
  const { state, fn } = setupHostWorld();
  try {
    fn.emit("peer.joined", { op: "peer.joined", playerId: "p_guest3", slot: 3 });
    const a = avatarFor(state, "p_guest3");
    const fx = a.tileX, fy = a.tileY;
    state.zone.collision[fy + 1][fx] = true;
    state.zone.biome[fy + 1][fx] = 2;
    fn.emit("move", { op: "move", seq: 200, from: "p_guest3", k: "pos", x: fx, y: fy + 0.6, d: "down", m: 1 });
    assert.deepEqual([a.x, a.y], [fx, fy]);
    assert.equal(_snapshotForTesting(state).lastSeq["p_guest3"], 200);

    fn.emit("move", { op: "move", seq: 201, from: "p_guest3", k: "pos", x: fx + 0.3, y: fy, d: "right", m: 1 });
    assert.deepEqual([a.x, a.y], [fx + 0.3, fy]);
  } finally { teardown(); }
});
