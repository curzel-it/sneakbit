// Long-running stutter hunt against production. Mirrors perfPublic.mjs
// but only runs the stutter workload, for ~90 s, with extra context
// captured around each snap event. Use to characterize the residual
// "1-2 s every minute" stutter the user still sees after the
// shouldSnap fix.
//
// Usage:  node tests/e2e/perfPublicLong.mjs

import { findChrome } from "./fixtures/chrome.mjs";
import { startCoopSession, runStutterLongWorkload } from "./fixtures/coopSession.mjs";

const APP_URL = process.env.SB_APP_URL || "https://sneakbit.curzel.it";
const RELAY_WS = process.env.SB_RELAY_WS || "wss://sneakbit.curzel.it/ws";
const TOTAL_MS = Number(process.env.SB_LONG_MS || 90_000);

function fmtSample(s) {
  return `fi=${s.fi} t(${s.tx},${s.ty}) xy(${s.x.toFixed(2)},${s.y.toFixed(2)}) step=${s.step ? "T" : "F"} dir=${s.dir} | auth t(${s.aTx},${s.aTy}) m=${s.aMoving ? "T" : "F"}`;
}

function summarize(label, result) {
  const { snaps, totalFrames } = result;
  console.log(`\n[stutter-long:${label}] totalFrames=${totalFrames}  snaps=${snaps.length}`);
  if (snaps.length === 0) return;

  // Cluster snaps that fire within 500 ms of each other into "bursts"
  // — the user reports "1-2 s of stuttering", which is multiple snaps
  // in sequence rather than one isolated event.
  const bursts = [];
  let cur = null;
  for (const s of snaps) {
    if (cur && (s.t - cur.lastT) < 500) {
      cur.snaps.push(s);
      cur.lastT = s.t;
    } else {
      if (cur) bursts.push(cur);
      cur = { firstT: s.t, lastT: s.t, snaps: [s] };
    }
  }
  if (cur) bursts.push(cur);

  console.log(`[stutter-long:${label}] bursts=${bursts.length}`);
  for (let bi = 0; bi < Math.min(bursts.length, 5); bi++) {
    const b = bursts[bi];
    const durationMs = b.lastT - b.firstT;
    console.log(`\n  --- burst ${bi + 1}: ${b.snaps.length} snaps over ${durationMs.toFixed(0)} ms (at t=${b.firstT.toFixed(0)} ms) ---`);
    const first = b.snaps[0];
    if (first.contextBefore && first.contextBefore.length) {
      console.log(`  context (last ${first.contextBefore.length} frames before the burst):`);
      for (const s of first.contextBefore.slice(-12)) console.log(`    ${fmtSample(s)}`);
    }
    for (const s of b.snaps.slice(0, 10)) {
      console.log(`  SNAP dist=${s.dist} dx=${s.dx} dy=${s.dy}  pred (${s.from.tx},${s.from.ty}) step=${s.from.step ? "T" : "F"} dir=${s.from.dir} → (${s.to.tx},${s.to.ty}) step=${s.to.step ? "T" : "F"}  auth (${s.auth.tx},${s.auth.ty}) m=${s.auth.moving ? "T" : "F"}`);
    }
  }
  if (bursts.length > 5) console.log(`  ...${bursts.length - 5} more bursts not shown`);
}

async function runOnce(label, { disableWebrtc }) {
  console.log(`\n[stutter-long] === ${label} (${(TOTAL_MS / 1000).toFixed(0)} s) ===`);
  const session = await startCoopSession({
    appUrl: APP_URL, relayWs: RELAY_WS,
    zone: 1001, entry: "deeplink", disableWebrtc,
    hostPort: disableWebrtc ? 9261 : 9263,
    guestPort: disableWebrtc ? 9262 : 9264,
    hostDir: `/tmp/sb-perf-long-host-${label}`,
    guestDir: `/tmp/sb-perf-long-guest-${label}`,
  });
  try {
    return await runStutterLongWorkload(session, { totalMs: TOTAL_MS });
  } finally { session.stop(); }
}

async function main() {
  if (!findChrome()) throw new Error("Chrome not found");
  console.log(`[stutter-long] app=${APP_URL}  relay=${RELAY_WS}`);

  const rtc = await runOnce("rtc", { disableWebrtc: false });
  summarize("rtc", rtc);
  await new Promise((r) => setTimeout(r, 1000));
  const ws = await runOnce("ws", { disableWebrtc: true });
  summarize("ws", ws);

  console.log(`\n========== SUMMARY ==========`);
  console.log(`WebRTC: ${rtc.snaps.length} snaps over ${rtc.totalFrames} frames`);
  console.log(`WS-only: ${ws.snaps.length} snaps over ${ws.totalFrames} frames`);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
