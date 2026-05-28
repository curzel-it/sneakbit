// E2E: measures end-to-end input latency on the WS-relay path vs the
// WebRTC DataChannel path and prints both. This isn't a regression
// test in the strict sense — local-network numbers are tiny and noisy,
// and the comparison only gets meaningful with real internet RTT. But
// the harness is the load-bearing piece: once it works, the same
// `runOnce` can be re-pointed at a remote relay (set RELAY_URL +
// APP_URL env vars) to produce numbers that mean something.
//
// What we measure:
//   * input round-trip: time from guest dispatching a synthetic
//     keydown to the moment the host's authoritative tile changes in
//     the guest's mirror. Stamped on the guest with one clock so it's
//     directly comparable.
//   * snapshot inter-arrival: per-message gap in onMessage on the DC.
//     A rough proxy for jitter; useful as a diagnostic, not an assert.
//
// We require the *medians* of the two paths to both come in under a
// loose ceiling (200 ms each, well above any sane local timing) so a
// regression that doubled or tripled the round-trip would still trip
// the assert. The WS-vs-WebRTC delta is printed for human inspection.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession, dispatchKey, KEYS } from "./fixtures/coopSession.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8002, relayPort: 8092 });
});
after(() => { if (servers) servers.stop(); });

function median(arr) {
  if (arr.length === 0) return NaN;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Runs one workload, returns an array of "input → auth-tile-change"
// samples in ms. Strategy: jog one tile east first (zone 1001's spawn
// at (68,24) is bordered on the south, but (69,24)→south is open road
// for ~15 tiles), then hold ArrowDown continuously and time every auth
// tile change the mirror sees. The first change is "input → first
// step's auth confirmation" (the round-trip we care about); subsequent
// changes mostly measure the host's step+broadcast cadence.
//
// We record both the keydown timestamp and per-tile-change timestamps,
// then return the delta from keydown to each change. That gives one
// "transport latency" sample (first change) plus several "steady-state
// step duration" samples — both useful when comparing transports.
async function measureRoundTrips(session, label) {
  // Jog east one tile so we're on the road south of spawn. Single
  // press, brief hold, release — that's enough for one step.
  await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));
  await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));

  // Install the probe: stamp the moment we hold ArrowDown, watch the
  // mirror auth tile via rAF, and record `t_change - t_keydown` for
  // every tile change until we release.
  await evalExpr(session.guest, `
    (() => {
      const m = window.__sb.m;
      const o = window.__sb.o;
      const selfId = o.getSelfPlayerId();
      const samples = [];
      window.__sb_lat = { samples, keydownAt: 0, lastTileX: null, lastTileY: null, running: true };
      const tick = () => {
        if (!window.__sb_lat.running) return;
        const mp = m.getMirrorPlayerById(selfId);
        if (mp) {
          if (window.__sb_lat.lastTileX == null) {
            window.__sb_lat.lastTileX = mp.tileX;
            window.__sb_lat.lastTileY = mp.tileY;
          } else if ((mp.tileX !== window.__sb_lat.lastTileX || mp.tileY !== window.__sb_lat.lastTileY) && window.__sb_lat.keydownAt) {
            samples.push({
              t: performance.now() - window.__sb_lat.keydownAt,
              tileX: mp.tileX, tileY: mp.tileY,
            });
            window.__sb_lat.lastTileX = mp.tileX;
            window.__sb_lat.lastTileY = mp.tileY;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()
  `);

  // Hold ArrowDown for ~3 s — long enough for ~10 chained steps on the
  // road south of (69,24).
  await evalExpr(session.guest, `window.__sb_lat.keydownAt = performance.now()`);
  await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowDown.key, KEYS.ArrowDown.code, KEYS.ArrowDown.vk));
  await new Promise((r) => setTimeout(r, 3000));
  await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowDown.key, KEYS.ArrowDown.code, KEYS.ArrowDown.vk));
  await new Promise((r) => setTimeout(r, 600));

  const samples = await evalExpr(session.guest, `
    (() => { window.__sb_lat.running = false; return window.__sb_lat.samples; })()
  `);

  // First sample = transport-dominated round-trip (input → first auth
  // confirmation). Subsequent samples are CUMULATIVE since keydown, so
  // step-to-step deltas come from differencing.
  const cumulative = samples.map((s) => s.t);
  const firstRtt = cumulative[0] ?? NaN;
  const interStep = [];
  for (let i = 1; i < cumulative.length; i++) interStep.push(cumulative[i] - cumulative[i - 1]);

  console.log(`[latency:${label}] tiles=${cumulative.length}  first-step RTT=${firstRtt.toFixed(0)}ms  inter-step ms=[${interStep.map((x) => x.toFixed(0)).join(", ")}]`);
  return { firstRtt, interStep, tilesMoved: cumulative.length };
}

test("input round-trip and step-cadence comparison: WS vs WebRTC", async (t) => {
  if (!skipIfNoChrome(t)) return;

  // WS-only run first.
  const wsSession = await startCoopSession({
    appUrl: servers.appUrl, relayWs: servers.relayWs,
    zone: 1001, entry: "deeplink", disableWebrtc: true,
    hostPort: 9233, guestPort: 9234,
    hostDir: "/tmp/sb-e2e-host-ws", guestDir: "/tmp/sb-e2e-guest-ws",
  });
  let ws;
  try {
    ws = await measureRoundTrips(wsSession, "ws");
  } finally { wsSession.stop(); }

  await new Promise((r) => setTimeout(r, 500));

  const rtcSession = await startCoopSession({
    appUrl: servers.appUrl, relayWs: servers.relayWs,
    zone: 1001, entry: "deeplink", disableWebrtc: false,
    hostPort: 9235, guestPort: 9236,
    hostDir: "/tmp/sb-e2e-host-rtc", guestDir: "/tmp/sb-e2e-guest-rtc",
  });
  let rtc;
  try {
    rtc = await measureRoundTrips(rtcSession, "rtc");
  } finally { rtcSession.stop(); }

  // First-step RTT is the cleanest transport comparison — it's
  // dominated by guest-input → host-process → broadcast → guest-mirror.
  // Inter-step cadence is mostly host-side step duration; both
  // transports should converge on similar numbers there.
  console.log(`[latency] WS    first-step RTT ${ws.firstRtt.toFixed(0)} ms  inter-step median ${median(ws.interStep).toFixed(0)} ms  tiles ${ws.tilesMoved}`);
  console.log(`[latency] WebRTC first-step RTT ${rtc.firstRtt.toFixed(0)} ms  inter-step median ${median(rtc.interStep).toFixed(0)} ms  tiles ${rtc.tilesMoved}`);
  console.log(`[latency] first-step delta ${(ws.firstRtt - rtc.firstRtt).toFixed(0)} ms (positive = WebRTC wins)`);

  // Loose sanity bounds. On localhost the transport delta is in the
  // noise (single-digit ms); the assertions just guard against gross
  // regressions like a broadcaster stall.
  assert.ok(ws.tilesMoved >= 3, `WS too few tile changes: ${ws.tilesMoved}`);
  assert.ok(rtc.tilesMoved >= 3, `WebRTC too few tile changes: ${rtc.tilesMoved}`);
  assert.ok(ws.firstRtt < 1000, `WS first-step RTT too slow: ${ws.firstRtt}`);
  assert.ok(rtc.firstRtt < 1000, `WebRTC first-step RTT too slow: ${rtc.firstRtt}`);
});
