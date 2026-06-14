// End-to-end Tower Defense run through the real module graph + DOM HUD,
// driven via the ?mode=td deep link. Asserts the whole loop wires up: the
// board + squad boot with a visible sand path, the build→wave→clear cycle
// runs, enemies spawn and march, kills score + bank gold, off-path obstacles
// are placed once at map load and stay fixed across waves, clearing the map's wave quota advances to a
// fresh harder map, hero switching cycles, and a leak ends the run — all with
// zero uncaught page exceptions. Self-skips when Chrome isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findChrome, skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8011;
const RELAY_PORT = 8101;
const CHROME_PORT = 9271;

test("tower defense boots, runs a wave, scores kills, and ends on a leak", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-td" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  // Fail loud on any uncaught page exception.
  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/play/?mode=td`);

  // — Boot: TD installed + a build phase with a solo 1-hero squad ————————
  await waitFor(s, "!!window.td");
  await waitFor(s, "window.td.state().phase === 'build'");

  assert.equal(await evalExpr(s, "window.td.squad()"), 1, "solo starts with one hero (the Ninja)");
  assert.ok(await evalExpr(s, "window.td.state().coins > 0"), "starting coins granted");
  assert.ok(await evalExpr(s, "!!document.getElementById('td-hud') && getComputedStyle(document.getElementById('td-hud')).display !== 'none'"), "HUD visible");
  assert.ok(await evalExpr(s, "window.td.state().lives > 0"), "village starts with lives, not instant-loss");

  // — The sand path AND the map's obstacles are visible from the start ————————
  assert.ok(await evalExpr(s, "window.td.sandCount() > 0"), "a sand path is painted at boot");
  const obstaclesAtBoot = await evalExpr(s, "window.td.maze().revealed");
  assert.ok(obstaclesAtBoot > 0, "obstacles are placed once at map load");
  assert.equal(await evalExpr(s, "window.td.state().mapIndex"), 0, "run starts on map 0");

  // — Recruiting grows the squad with a real second hero ———————————————————
  await evalExpr(s, "window.td.coins(500)");
  await evalExpr(s, "window.td.recruit()");
  assert.equal(await evalExpr(s, "window.td.squad()"), 2, "recruited a second hero");

  // — Wave: enemies spawn and the horde populates ————————————————————————
  await evalExpr(s, "window.td.startWave()");
  await waitFor(s, "window.td.state().phase === 'wave'");
  const peak = await waitFor(s, "(window.td.enemies() > 0) ? window.td.enemies() : null", { timeoutMs: 8000 });
  assert.ok(peak > 0, "enemies spawned onto the board");

  // — Kills bank gold + score ———————————————————————————————————————————
  // Enemies keep spawning across the wave, so sweep repeatedly until the wave
  // resolves back to build (a single killAll only flags the current batch).
  const before = await evalExpr(s, "window.td.state()");
  await waitFor(s, "(window.td.killAll(), window.td.state().phase === 'build')", { timeoutMs: 15000 });
  const after = await evalExpr(s, "window.td.state()");
  assert.ok(after.score > before.score, "kills scored points");
  assert.ok(after.coins >= before.coins, "kills + stipend banked coins");
  assert.ok(after.wave >= 1, "survived a wave");

  // — Obstacles are fixed for the map: unchanged after the wave clears ————————
  // (Path-locking + solvability are unit-tested in tests/tdMaze.test.js.)
  assert.equal(after.waveInMap, 1, "one wave cleared on this map");
  assert.equal(await evalExpr(s, "window.td.maze().revealed"), obstaclesAtBoot, "obstacles stay fixed between waves on the same map");

  // — Clearing the map's wave quota advances to a fresh, harder map ————————
  await evalExpr(s, "window.td.win(); window.td.win();"); // reach WAVES_PER_MAP clears
  await waitFor(s, "window.td.state().mapIndex === 1", { timeoutMs: 8000 });
  assert.ok(await evalExpr(s, "window.td.sandCount() > 0"), "the new map paints a fresh sand path");

  // — Hero switching cycles the active slot ——————————————————————————————
  const a0 = await evalExpr(s, "window.td.activeIndex()");
  await evalExpr(s, "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Tab'}))");
  const a1 = await evalExpr(s, "window.td.activeIndex()");
  assert.notEqual(a0, a1, "Tab cycles to the next hero");

  // — A leak ends the run and raises the game-over screen ————————————————
  await evalExpr(s, "window.td.lose()");
  await waitFor(s, "getComputedStyle(document.getElementById('td-gameover')).display !== 'none'");
  assert.equal(await evalExpr(s, "window.td.state().phase"), "gameover");

  assert.deepEqual(errors, [], `no uncaught page exceptions: ${errors.join("; ")}`);
});
