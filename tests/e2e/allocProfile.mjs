// Ad-hoc per-frame allocation profiler for the offline game.
//
// Boots one offline single-player page in headless Chrome and measures
// bytes-allocated-per-frame (and the per-call-frame breakdown) for two
// workloads:
//   idle   — no input; pure render + entity-tick steady-state churn.
//   moving — hold + flip movement keys so step/snap/chain/animation run too.
//
// Why a script and not a test: these are exploratory numbers used while
// cutting allocations. allocations.test.mjs is the regression backstop.
//
// Usage:  node tests/e2e/allocProfile.mjs
//         SB_ZONE=1001 node tests/e2e/allocProfile.mjs   (override boot zone)

import { findChrome, launchChrome, getTargets, connectSession, evalExpr, navigate, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { dispatchKey, KEYS } from "./fixtures/coopSession.mjs";
import { profileAllocations, printAllocReport } from "./fixtures/allocProfile.mjs";

const ZONE = process.env.SB_ZONE || "1001";
const FRAMES = parseInt(process.env.SB_FRAMES || "600", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Drive: hold a direction, flipping every ~600ms so the avatar keeps stepping
// (and chaining) rather than walking into a wall and idling. Runs for roughly
// the measurement window plus a cushion.
async function driveMoving(session) {
  const order = [KEYS.ArrowRight, KEYS.ArrowDown, KEYS.ArrowLeft, KEYS.ArrowUp];
  const durationMs = (FRAMES / 60) * 1000 + 2000;
  const t0 = Date.now();
  let i = 0;
  let prev = null;
  while (Date.now() - t0 < durationMs) {
    const k = order[i % order.length];
    if (prev) await evalExpr(session, dispatchKey("keyup", prev.key, prev.code, prev.vk));
    await evalExpr(session, dispatchKey("keydown", k.key, k.code, k.vk));
    prev = k;
    i++;
    await sleep(600);
  }
  if (prev) await evalExpr(session, dispatchKey("keyup", prev.key, prev.code, prev.vk));
}

async function main() {
  if (!findChrome()) throw new Error("Chrome not found (set CHROME_PATH)");
  const servers = await startServers({ staticPort: 8011, relayPort: 8101 });
  const chrome = await launchChrome({ port: 9281, dataDir: "/tmp/sb-alloc-profile" });
  try {
    const targets = await getTargets(9281);
    const page = targets.find((x) => x.type === "page");
    const s = await connectSession(page.webSocketDebuggerUrl);
    s.on("Runtime.exceptionThrown", (p) =>
      console.error("[page error]", p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

    await navigate(s, `${servers.appUrl}/index.html?zone=${ZONE}`);
    await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");
    // Let the zone settle (cache bake, first frames) before measuring.
    await sleep(1500);

    console.log(`[alloc] zone=${ZONE} frames=${FRAMES}`);

    const idle = await profileAllocations(s, { frames: FRAMES });
    printAllocReport("idle", idle);

    const moving = await profileAllocations(s, { frames: FRAMES, drive: driveMoving });
    printAllocReport("moving", moving);

    s.close();
  } finally {
    chrome.kill();
    servers.stop();
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
