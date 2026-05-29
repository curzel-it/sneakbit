// Host-side broadcast of the local pause state. Verifies that
// setHostPaused emits event:hostPause on rising/falling edges and
// that the peer.joined handler re-broadcasts the current value so a
// guest who joins mid-pause sees the right overlay.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260529d");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260529d");
const {
  setHostPaused,
  installHostPauseBroadcaster,
  _resetHostPauseStateForTesting,
} = await import("../js/hostPauseState.js?v=20260529d");

function makeFakeNet() {
  const handlers = new Map();
  const sent = [];
  return {
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
    },
    emit(op, msg) { for (const h of (handlers.get(op) || []).slice()) h(msg); },
    send: (m) => { sent.push(m); return true; },
    connect: () => {},
    close: () => {},
    isConnected: () => true,
    getUuid: () => "uuid-host",
    getUrl: () => "ws://test",
    sent,
  };
}

function setupHost() {
  _resetHostPauseStateForTesting();
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host" });
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Host" });
  installHostPauseBroadcaster({ net });
  return { net };
}

function teardown() {
  _resetHostPauseStateForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
}

test("setHostPaused(true) broadcasts event:hostPause with paused=true", () => {
  const { net } = setupHost();
  setHostPaused(true);
  const pauseFrames = net.sent.filter((m) => m.kind === "hostPause");
  assert.equal(pauseFrames.length, 1);
  assert.equal(pauseFrames[0].paused, true);
  teardown();
});

test("setHostPaused does not re-broadcast when the value hasn't changed", () => {
  const { net } = setupHost();
  setHostPaused(true);
  setHostPaused(true);
  setHostPaused(true);
  const pauseFrames = net.sent.filter((m) => m.kind === "hostPause");
  assert.equal(pauseFrames.length, 1);
  teardown();
});

test("setHostPaused fires on both rising and falling edges", () => {
  const { net } = setupHost();
  setHostPaused(true);
  setHostPaused(false);
  const pauseFrames = net.sent.filter((m) => m.kind === "hostPause");
  assert.equal(pauseFrames.length, 2);
  assert.equal(pauseFrames[0].paused, true);
  assert.equal(pauseFrames[1].paused, false);
  teardown();
});

test("peer.joined re-broadcasts the current paused value so late joiners aren't out of sync", () => {
  const { net } = setupHost();
  setHostPaused(true);
  const before = net.sent.filter((m) => m.kind === "hostPause").length;
  net.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const after = net.sent.filter((m) => m.kind === "hostPause").length;
  assert.equal(after, before + 1);
  // And it carries the current state, not a default.
  const last = net.sent.filter((m) => m.kind === "hostPause").at(-1);
  assert.equal(last.paused, true);
  teardown();
});
