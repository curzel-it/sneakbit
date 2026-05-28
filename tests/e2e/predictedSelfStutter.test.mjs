// E2E: hunts for "guest's own avatar jumps without walking" — i.e.
// `predictedSelf.shouldSnap` firing during continuous motion and
// nuking the in-flight step. The user reports this on their actual
// guest client (production), but the local-network rig doesn't have
// enough RTT for the host's auth to land mid-step, so this test runs
// informationally on localhost: it should report ~zero snaps. To
// reproduce the user's symptom, run perfPublic.mjs against production
// where the host-ahead race is real.
//
// The detection is purely client-side: per-frame x/y delta. Normal
// step motion at 60 fps is ~0.07 tile/frame; a jump of >0.15 tile in
// one frame is the snap signature. We don't need to instrument
// `shouldSnap` directly — the visible jump is what matters.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession, runStutterWorkload } from "./fixtures/coopSession.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8003, relayPort: 8093 });
});
after(() => { if (servers) servers.stop(); });

function summarize(label, result) {
  const { samples, snaps } = result;
  const totalSpan = samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) : 0;
  console.log(`[stutter:${label}] samples=${samples.length} over ${totalSpan.toFixed(0)} ms, snap events=${snaps.length}`);
  for (const s of snaps.slice(0, 5)) {
    console.log(`  snap dist=${s.dist} dx=${s.dx} dy=${s.dy}  from tile (${s.from.tx},${s.from.ty}) step=${s.from.step} → tile (${s.to.tx},${s.to.ty}) step=${s.to.step}  auth tile (${s.auth.tx},${s.auth.ty})`);
  }
}

test("guest predicted-self snap-jumps during up/down cycles (WebRTC)", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl, relayWs: servers.relayWs,
    zone: 1001, entry: "deeplink",
    hostPort: 9253, guestPort: 9254,
    hostDir: "/tmp/sb-e2e-host-stutter-rtc", guestDir: "/tmp/sb-e2e-guest-stutter-rtc",
  });
  t.after(() => session.stop());

  const result = await runStutterWorkload(session, { cycles: 3, holdMs: 1800 });
  summarize("rtc", result);

  // We assert only that the harness collected real data — no hard
  // bound on snap count because localhost won't trigger them but prod
  // (different test runner) will. The snap details land in stdout
  // either way for a human to read.
  assert.ok(result.samples.length > 100, `expected >100 samples, got ${result.samples.length}`);
});

test("guest predicted-self snap-jumps during up/down cycles (WS-only)", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl, relayWs: servers.relayWs,
    zone: 1001, entry: "deeplink", disableWebrtc: true,
    hostPort: 9255, guestPort: 9256,
    hostDir: "/tmp/sb-e2e-host-stutter-ws", guestDir: "/tmp/sb-e2e-guest-stutter-ws",
  });
  t.after(() => session.stop());

  const result = await runStutterWorkload(session, { cycles: 3, holdMs: 1800 });
  summarize("ws", result);

  assert.ok(result.samples.length > 100, `expected >100 samples, got ${result.samples.length}`);
});
