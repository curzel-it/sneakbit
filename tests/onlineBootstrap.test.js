// Guest session-termination contract: a host kick (`kicked` op / 4005 close)
// or a host quit (`session.closed` op / 1000-1001 close) must fire
// onSessionEnded exactly once so main.js can drop the guest back offline and
// restore its own saved world. Transient drops (1006) must NOT fire it.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260531b");
const { _resetOnlineBootstrapForTesting, bootstrapOnline, onSessionEnded } =
  await import("../js/onlineBootstrap.js?v=20260531b");

function makeFakeNet() {
  const handlers = new Map();
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
    send: () => true,
    connect: () => {},
    close: () => {},
    isConnected: () => true,
    getUuid: () => "uuid-guest",
    getUrl: () => "ws://test",
    handlers,
  };
}

// Wires the real onlineBootstrap handlers onto a fake net (the same path
// hostGuests.test.js uses) and registers an onSessionEnded spy. The welcome
// emit puts us "in a session" and arms the once-per-session guard.
function setup() {
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "guest", uuid: "uuid-guest" });
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  const ended = [];
  onSessionEnded((e) => ended.push(e));
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "g1", name: "Guest" });
  return { net, ended };
}

function teardown() {
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
}

test("kick op returns the guest to offline (fires session-ended once)", () => {
  const { net, ended } = setup();
  net.emit("kicked", { reason: "kicked" });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "kicked");
  teardown();
});

test("kick op + following 4005 close fires only once (de-duped)", () => {
  const { net, ended } = setup();
  net.emit("kicked", {});
  net.emit("_close", { code: 4005, reason: "kicked by host" });
  assert.equal(ended.length, 1, "the close-code backstop must not double-fire");
  assert.equal(ended[0].reason, "kicked");
  teardown();
});

test("4005 close alone (op lost) still returns the guest to offline", () => {
  const { net, ended } = setup();
  net.emit("_close", { code: 4005, reason: "kicked by host" });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "kicked");
  teardown();
});

test("session.closed op (host quit) fires with the host's reason", () => {
  const { net, ended } = setup();
  net.emit("session.closed", { reason: "host_quit" });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "host_quit");
  teardown();
});

test("1000 close (host ended) fires session-ended", () => {
  const { net, ended } = setup();
  net.emit("_close", { code: 1000, reason: "session closed" });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "host_ended");
  teardown();
});

test("1001 close (server going away) fires session-ended", () => {
  const { net, ended } = setup();
  net.emit("_close", { code: 1001 });
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, "host_ended");
  teardown();
});

test("transient drop (1006) does NOT end the session — net.js reconnects", () => {
  const { net, ended } = setup();
  net.emit("_close", { code: 1006 });
  assert.equal(ended.length, 0);
  teardown();
});

test("a fresh welcome re-arms the guard so a later kick fires again", () => {
  const { net, ended } = setup();
  net.emit("kicked", {});
  assert.equal(ended.length, 1);
  // Rejoin: welcome resets the once-per-session guard.
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "g1", name: "Guest" });
  net.emit("session.closed", { reason: "host_quit" });
  assert.equal(ended.length, 2);
  assert.equal(ended[1].reason, "host_quit");
  teardown();
});
