// Ad-hoc perf comparison run against the *public* deployment.
// Same `measureRoundTrips` workload as inputLatency.test.mjs but
// pointed at https://curzel.it/sneakbit-html + wss://sneakbit.curzel.it.
//
// Why a script and not a test: e2e tests deliberately own their
// servers so they're reproducible from a cold checkout. Production
// is a moving target; we want one-shot ad-hoc numbers, not a
// regression test.
//
// Usage:  node tests/e2e/perfPublic.mjs

import { findChrome } from "./fixtures/chrome.mjs";
import { startCoopSession, dispatchKey, KEYS, runStutterWorkload } from "./fixtures/coopSession.mjs";

const APP_URL = process.env.SB_APP_URL || "https://curzel.it/sneakbit-html";
const RELAY_WS = process.env.SB_RELAY_WS || "wss://sneakbit.curzel.it/ws";

function median(arr) {
  if (arr.length === 0) return NaN;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function evalGuest(session, expr) {
  return (await import("./fixtures/chrome.mjs")).evalExpr(session.guest, expr);
}

async function measureRoundTrips(session, label) {
  await evalGuest(session, dispatchKey("keydown", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));
  await evalGuest(session, dispatchKey("keyup", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));

  await evalGuest(session, `
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
            samples.push({ t: performance.now() - window.__sb_lat.keydownAt, tileX: mp.tileX, tileY: mp.tileY });
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

  await evalGuest(session, `window.__sb_lat.keydownAt = performance.now()`);
  await evalGuest(session, dispatchKey("keydown", KEYS.ArrowDown.key, KEYS.ArrowDown.code, KEYS.ArrowDown.vk));
  await new Promise((r) => setTimeout(r, 3500));
  await evalGuest(session, dispatchKey("keyup", KEYS.ArrowDown.key, KEYS.ArrowDown.code, KEYS.ArrowDown.vk));
  await new Promise((r) => setTimeout(r, 800));

  const samples = await evalGuest(session, `
    (() => { window.__sb_lat.running = false; return window.__sb_lat.samples; })()
  `);

  const cumulative = samples.map((s) => s.t);
  const firstRtt = cumulative[0] ?? NaN;
  const interStep = [];
  for (let i = 1; i < cumulative.length; i++) interStep.push(cumulative[i] - cumulative[i - 1]);
  console.log(`[perf-public:${label}] tiles=${cumulative.length}  first-step RTT=${firstRtt.toFixed(0)}ms  inter-step ms=[${interStep.map((x) => x.toFixed(0)).join(", ")}]`);
  return { firstRtt, interStep, tilesMoved: cumulative.length };
}

async function readRtcStats(session) {
  return evalGuest(session, `
    (async () => {
      const pcs = window.__sb_pcs || [];
      const out = [];
      for (const pc of pcs) {
        const info = { connectionState: pc.connectionState, channels: [], transport: null };
        try {
          const stats = await pc.getStats();
          for (const r of stats.values()) {
            if (r.type === 'data-channel') info.channels.push({
              label: r.label, state: r.state, msgSent: r.messagesSent, msgRecv: r.messagesReceived,
              bytesSent: r.bytesSent, bytesRecv: r.bytesReceived,
            });
            else if (r.type === 'transport') info.transport = {
              bytesSent: r.bytesSent, bytesRecv: r.bytesReceived,
              packetsSent: r.packetsSent, packetsRecv: r.packetsReceived, dtlsState: r.dtlsState,
            };
            else if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
              info.selectedPair = { currentRoundTripTime: r.currentRoundTripTime, availableOutgoingBitrate: r.availableOutgoingBitrate };
            }
          }
        } catch (e) { info.err = e.message; }
        out.push(info);
      }
      return out;
    })()
  `);
}

function captureConsole(session, label) {
  session.on("Runtime.consoleAPICalled", (ev) => {
    const txt = (ev.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (txt.includes("[online]") || txt.includes("[webrtc]") || txt.includes("[net]") || txt.includes("Error") || txt.includes("error")) {
      console.log(`[console:${label}]`, txt);
    }
  });
}

async function main() {
  if (!findChrome()) throw new Error("Chrome not found (CHROME_PATH env to override)");

  console.log(`[perf-public] app=${APP_URL}  relay=${RELAY_WS}`);

  // WebRTC run first this time so we can also see ICE/transport stats.
  console.log("[perf-public] === WebRTC run ===");
  const rtcSession = await startCoopSession({
    appUrl: APP_URL, relayWs: RELAY_WS,
    zone: 1001, entry: "deeplink", disableWebrtc: false,
    hostPort: 9243, guestPort: 9244,
    hostDir: "/tmp/sb-perf-host-rtc", guestDir: "/tmp/sb-perf-guest-rtc",
  });
  captureConsole(rtcSession.host, "rtc-host");
  captureConsole(rtcSession.guest, "rtc-guest");
  let rtc;
  try {
    rtc = await measureRoundTrips(rtcSession, "rtc");
    const stats = await readRtcStats(rtcSession);
    console.log("[perf-public:rtc] stats:", JSON.stringify(stats, null, 2));
  } finally { rtcSession.stop(); }

  await new Promise((r) => setTimeout(r, 1000));

  console.log("[perf-public] === WS-only run ===");
  const wsSession = await startCoopSession({
    appUrl: APP_URL, relayWs: RELAY_WS,
    zone: 1001, entry: "deeplink", disableWebrtc: true,
    hostPort: 9245, guestPort: 9246,
    hostDir: "/tmp/sb-perf-host-ws", guestDir: "/tmp/sb-perf-guest-ws",
  });
  let ws;
  try {
    ws = await measureRoundTrips(wsSession, "ws");
  } finally { wsSession.stop(); }

  console.log("\n========== LATENCY SUMMARY ==========");
  console.log(`WS     first-step RTT ${ws.firstRtt.toFixed(0)} ms  inter-step median ${median(ws.interStep).toFixed(0)} ms  tiles ${ws.tilesMoved}`);
  console.log(`WebRTC first-step RTT ${rtc.firstRtt.toFixed(0)} ms  inter-step median ${median(rtc.interStep).toFixed(0)} ms  tiles ${rtc.tilesMoved}`);
  console.log(`Delta  ${(ws.firstRtt - rtc.firstRtt).toFixed(0)} ms (positive = WebRTC wins)`);

  // --- Stutter workload: same drive on a fresh session per transport.
  // We can't reuse the latency session because the avatar is now far
  // down the road and probably blocked. Cycles of down/up exercise the
  // chained-step flow where the user reports the guest-own-avatar
  // jump.
  await new Promise((r) => setTimeout(r, 1000));
  console.log("\n[perf-public] === Stutter workload (WebRTC) ===");
  const rtcStut = await startCoopSession({
    appUrl: APP_URL, relayWs: RELAY_WS,
    zone: 1001, entry: "deeplink", disableWebrtc: false,
    hostPort: 9247, guestPort: 9248,
    hostDir: "/tmp/sb-perf-host-stut-rtc", guestDir: "/tmp/sb-perf-guest-stut-rtc",
  });
  let rtcStutter;
  try {
    rtcStutter = await runStutterWorkload(rtcStut, { cycles: 4, holdMs: 1800 });
  } finally { rtcStut.stop(); }
  printStutter("rtc", rtcStutter);

  await new Promise((r) => setTimeout(r, 1000));
  console.log("\n[perf-public] === Stutter workload (WS-only) ===");
  const wsStut = await startCoopSession({
    appUrl: APP_URL, relayWs: RELAY_WS,
    zone: 1001, entry: "deeplink", disableWebrtc: true,
    hostPort: 9249, guestPort: 9250,
    hostDir: "/tmp/sb-perf-host-stut-ws", guestDir: "/tmp/sb-perf-guest-stut-ws",
  });
  let wsStutter;
  try {
    wsStutter = await runStutterWorkload(wsStut, { cycles: 4, holdMs: 1800 });
  } finally { wsStut.stop(); }
  printStutter("ws", wsStutter);

  console.log("\n========== STUTTER SUMMARY ==========");
  console.log(`WebRTC snap events: ${rtcStutter.snaps.length}  samples: ${rtcStutter.samples.length}`);
  console.log(`WS     snap events: ${wsStutter.snaps.length}  samples: ${wsStutter.samples.length}`);
}

function printStutter(label, result) {
  const { samples, snaps } = result;
  const span = samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) : 0;
  console.log(`[stutter:${label}] samples=${samples.length} over ${span.toFixed(0)} ms, snap events=${snaps.length}`);
  for (const s of snaps.slice(0, 10)) {
    console.log(`  snap dist=${s.dist} dx=${s.dx} dy=${s.dy}  predicted (${s.from.tx},${s.from.ty}) step=${s.from.step} dir=${s.from.dir} → (${s.to.tx},${s.to.ty}) step=${s.to.step}  auth (${s.auth.tx},${s.auth.ty}) moving=${s.auth.moving}`);
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
