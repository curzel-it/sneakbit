// E2E regression backstop for per-frame heap allocation.
//
// Boots one offline single-player page, samples allocations (CDP HeapProfiler)
// over an idle window and a moving window, and asserts a GENEROUS ceiling on
// bytes-allocated-per-frame. This is deliberately not a tight budget — the
// point is to catch a regression that reintroduces big per-frame churn (a `new
// Set`/array/object back on the hot path), not to police every byte. The
// sampling profiler is also statistically noisy run-to-run, so the ceilings
// sit well above the observed baseline.
//
// See tests/e2e/allocProfile.mjs for the ad-hoc, ranked-breakdown version used
// while cutting allocations, and tests/e2e/fixtures/allocProfile.mjs for the
// shared profiler.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { dispatchKey, KEYS } from "./fixtures/coopSession.mjs";
import { profileAllocations, printAllocReport } from "./fixtures/allocProfile.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generous per-frame ceilings (bytes of js/ allocation per frame). Observed
// baselines after the alloc pass: idle ~75-95 B, moving ~160-210 B even in the
// busiest zone. ~5× headroom keeps the test green under sampling noise while
// still flagging a real regression.
const IDLE_CEIL = 600;
const MOVING_CEIL = 1200;

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8015, relayPort: 8105 });
});
after(() => { if (servers) servers.stop(); });

async function driveMoving(session) {
  const order = [KEYS.ArrowRight, KEYS.ArrowDown, KEYS.ArrowLeft, KEYS.ArrowUp];
  const t0 = Date.now();
  let prev = null, i = 0;
  while (Date.now() - t0 < 11_000) {
    const k = order[i % order.length];
    if (prev) await evalExpr(session, dispatchKey("keyup", prev.key, prev.code, prev.vk));
    await evalExpr(session, dispatchKey("keydown", k.key, k.code, k.vk));
    prev = k; i++;
    await sleep(600);
  }
  if (prev) await evalExpr(session, dispatchKey("keyup", prev.key, prev.code, prev.vk));
}

test("per-frame heap allocation stays low (idle + moving)", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9285, dataDir: "/tmp/sb-e2e-alloc" });
  t.after(() => chrome.kill());
  const targets = await getTargets(9285);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");
  await sleep(1500); // let the zone cache bake + first frames settle

  const idle = await profileAllocations(s, { frames: 600, samplingInterval: 1024 });
  printAllocReport("idle", idle);
  assert.ok(idle.frames >= 200, `idle window should have advanced many frames (got ${idle.frames})`);
  assert.ok(
    idle.ourBytesPerFrame < IDLE_CEIL,
    `idle js/ allocation ${idle.ourBytesPerFrame.toFixed(0)} B/frame exceeds ceiling ${IDLE_CEIL} B/frame`,
  );

  const moving = await profileAllocations(s, { frames: 600, samplingInterval: 1024, drive: driveMoving });
  printAllocReport("moving", moving);
  assert.ok(
    moving.ourBytesPerFrame < MOVING_CEIL,
    `moving js/ allocation ${moving.ourBytesPerFrame.toFixed(0)} B/frame exceeds ceiling ${MOVING_CEIL} B/frame`,
  );

  assert.equal(errors.length, 0, `page errors: ${errors.join("; ")}`);
});
