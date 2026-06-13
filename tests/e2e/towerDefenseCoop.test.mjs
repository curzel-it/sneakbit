// End-to-end local co-op Tower Defense: two players on one device, each driving
// a distinct hero. Boots a solo TD run via ?mode=td, restarts it as a 2-player
// co-op run (window.td.startCoop), then asserts the squad spawns one hero per
// player, ownership is per-slot, split-screen is on, and each player's keymap
// moves only that player's hero. Self-skips when Chrome isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8012;
const RELAY_PORT = 8102;
const CHROME_PORT = 9272;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tileOf(s, i) {
  const arr = await evalExpr(s, "window.td.heroTiles()");
  return (arr || []).find((h) => h.i === i) || null;
}

// Wait until hero `i` stops moving (tile stable across several polls). A hero
// finishes its current tile step after keyup, so callers settle before reading
// a baseline they expect to stay fixed.
async function settle(s, i) {
  let last = null, stable = 0;
  for (let t = 0; t < 25 && stable < 3; t++) {
    await sleep(100);
    const now = await tileOf(s, i);
    const key = now ? `${now.x},${now.y}` : "";
    if (key === last) stable++; else { stable = 0; last = key; }
  }
}

// Drive hero `i` with the given keymap until it steps to a new tile: try each
// direction in turn (some may be blocked by terrain), holding the key until the
// hero moves or a short window elapses. Returns the code that worked, or null.
async function driveOneTile(s, codes, i) {
  for (const code of codes) {
    const before = await tileOf(s, i);
    await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))`);
    let moved = false;
    for (let t = 0; t < 10 && !moved; t++) {
      await sleep(120);
      const now = await tileOf(s, i);
      if (now && before && (now.x !== before.x || now.y !== before.y)) moved = true;
    }
    await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keyup',{code:'${code}'}))`);
    if (moved) return code;
  }
  return null;
}

test("local co-op TD: two players each drive a distinct hero", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-td-coop" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/play/?mode=td`);
  await waitFor(s, "!!window.td");
  await waitFor(s, "window.td.state().phase === 'build'");

  // — Restart as a 2-player local co-op run ————————————————————————————————
  await evalExpr(s, "window.td.startCoop(2)");
  await waitFor(s, "window.td.state().phase === 'build'");
  assert.equal(await evalExpr(s, "window.td.players()"), 2, "two local players");
  assert.equal(await evalExpr(s, "window.td.squad()"), 2, "one hero per player");

  // — Ownership is per-slot: P1 drives hero 0, P2 drives hero 1 ——————————————
  assert.equal(await evalExpr(s, "window.td.ownerSlot(0)"), 1, "slot 1 owns hero 0");
  assert.equal(await evalExpr(s, "window.td.ownerSlot(1)"), 2, "slot 2 owns hero 1");

  // — Split-screen is on: one follow-self slice per player ——————————————————
  assert.equal(await evalExpr(s, "window.td.slices()"), 2, "two split-screen slices");

  // — P2's keymap moves only hero 1 ————————————————————————————————————————
  await settle(s, 0); await settle(s, 1);
  const p1Before = await tileOf(s, 0);
  const movedP2 = await driveOneTile(s, ["KeyJ", "KeyL", "KeyI", "KeyK"], 1);
  assert.ok(movedP2, "P2 (IJKL) moved its own hero");
  await settle(s, 1);
  const p1After = await tileOf(s, 0);
  assert.deepEqual(
    { x: p1After.x, y: p1After.y }, { x: p1Before.x, y: p1Before.y },
    "P1's hero stayed put while only P2 pressed keys",
  );

  // — P1's keymap moves only hero 0 ————————————————————————————————————————
  const p2Before = await tileOf(s, 1);
  const movedP1 = await driveOneTile(s, ["KeyA", "KeyD", "KeyW", "KeyS"], 0);
  assert.ok(movedP1, "P1 (WASD) moved its own hero");
  await settle(s, 0);
  const p2After = await tileOf(s, 1);
  assert.deepEqual(
    { x: p2After.x, y: p2After.y }, { x: p2Before.x, y: p2Before.y },
    "P2's hero stayed put while only P1 pressed keys",
  );

  assert.deepEqual(errors, [], `no uncaught page exceptions: ${errors.join("; ")}`);
});
