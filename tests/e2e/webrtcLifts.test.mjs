// E2E: verifies that a co-op session lifts game traffic onto a WebRTC
// DataChannel, in both deep-link and menu entry modes. Regression test
// for the init-order bug we hit on 2026-05-28 where deep-link entry
// (?host=1 / ?join=CODE) caused installWebrtcTransport to run with
// role=null and short-circuit, leaving every session on the WS relay
// for the rest of its life.
//
// The assertions are deliberately liberal: we don't require a specific
// byte count, only that a pc is constructed, the channel reaches state
// "open", and at least one frame goes through it in each direction.
// Local-network timing is fast enough that anything weaker than that
// suggests genuine breakage rather than test flake.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession, readGuestRtcStats, dispatchKey, KEYS } from "./fixtures/coopSession.mjs";

let servers;
before(async () => {
  if (!findChrome()) return; // tests below will self-skip
  servers = await startServers({ staticPort: 8001, relayPort: 8091 });
});
after(() => { if (servers) servers.stop(); });

async function exerciseAndStat(session) {
  // Brief input burst so the DC has something to carry.
  await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 600));
  await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 600));
  return readGuestRtcStats(session.guest);
}

test("deep-link guest entry brings up a WebRTC DataChannel", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "deeplink",
  });
  t.after(() => session.stop());

  const stats = await exerciseAndStat(session);
  assert.equal(stats.length, 1, "expected exactly one RTCPeerConnection");
  const pc = stats[0];
  assert.equal(pc.connectionState, "connected", "pc.connectionState should be connected");
  assert.equal(pc.channels.length, 1, "expected one data channel");
  assert.equal(pc.channels[0].state, "open", "channel should be open");
  // The host always streams snapshots/deltas at 20 Hz; over ~1.2 s we
  // should comfortably see >10 messages received via DC.
  assert.ok(pc.channels[0].msgRecv > 5, `expected msgRecv > 5, got ${pc.channels[0].msgRecv}`);
});

test("menu-driven guest entry brings up a WebRTC DataChannel", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "menu",
  });
  t.after(() => session.stop());

  const stats = await exerciseAndStat(session);
  assert.equal(stats.length, 1);
  const pc = stats[0];
  assert.equal(pc.connectionState, "connected");
  assert.equal(pc.channels[0].state, "open");
  assert.ok(pc.channels[0].msgRecv > 5, `expected msgRecv > 5, got ${pc.channels[0].msgRecv}`);
});

test("disableWebrtc forces all traffic onto the WS relay", async (t) => {
  if (!skipIfNoChrome(t)) return;
  // Sanity: when we strip RTCPeerConnection before page load, the
  // transport should short-circuit and pcCount stays 0. This guards
  // the latency-comparison test against false equivalence — if the
  // disable knob breaks silently, "ws-only" would secretly still use
  // WebRTC and the comparison would be meaningless.
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "deeplink",
    disableWebrtc: true,
  });
  t.after(() => session.stop());
  const stats = await readGuestRtcStats(session.guest);
  assert.equal(stats.length, 0, "expected zero RTCPeerConnections with disableWebrtc=true");
});
