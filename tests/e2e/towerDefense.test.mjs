// End-to-end Tower Defense run through the real module graph + DOM HUD,
// driven via the ?mode=td deep link. Asserts the whole loop wires up: the
// board + squad boot, the build→wave→clear cycle runs, enemies spawn and
// march, kills score + bank gold, placed barrels respect the anti-wall-off rule,
// hero switching cycles, and a leak ends the run — all with zero uncaught
// page exceptions. Self-skips when Chrome isn't installed.

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

  await navigate(s, `${servers.appUrl}/index.html?mode=td`);

  // — Boot: TD installed + a build phase with a 2-hero squad ————————————
  await waitFor(s, "!!window.td");
  await waitFor(s, "window.td.state().phase === 'build'");
  assert.equal(await evalExpr(s, "window.td.squad()"), 2, "Ninja + Barbarian present");
  assert.ok(await evalExpr(s, "window.td.state().gold > 0"), "starting gold granted");
  assert.ok(await evalExpr(s, "!!document.getElementById('td-hud') && getComputedStyle(document.getElementById('td-hud')).display !== 'none'"), "HUD visible");
  assert.ok(await evalExpr(s, "window.td.state().lives > 0"), "village starts with lives, not instant-loss");

  // — Recruiting grows the squad with a real third hero ————————————————————
  await evalExpr(s, "window.td.gold(500)");
  await evalExpr(s, "window.td.recruit()");
  assert.equal(await evalExpr(s, "window.td.squad()"), 3, "recruited a third hero");

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
  assert.ok(after.gold >= before.gold, "kills + stipend banked gold");
  assert.ok(after.wave >= 1, "survived a wave");

  // — Hero switching cycles the active slot ——————————————————————————————
  const a0 = await evalExpr(s, "window.td.activeIndex()");
  await evalExpr(s, "window.dispatchEvent(new KeyboardEvent('keydown',{code:'Tab'}))");
  const a1 = await evalExpr(s, "window.td.activeIndex()");
  assert.notEqual(a0, a1, "Tab cycles to the next hero");

  // — Barrel anti-wall-off: a legal barrel places; the goal can't be sealed —
  await evalExpr(s, "window.td.gold(500)");
  const placed = await evalExpr(s, "window.td.place(20, 20)");
  assert.equal(placed, true, "a barrel on an open tile places");
  assert.equal(await evalExpr(s, "window.td.obstacles()"), 1, "the placed barrel is tracked");

  // The village (goal at 57,20) sits in a pocket reached only through the
  // six-tile neck at x=55, rows 17..22. Five barrels plug five of them; the
  // sixth would seal the village off from every spawn — it must be refused
  // and cost no gold (the placement reverts before spending).
  for (const y of [17, 18, 19, 20, 21]) {
    assert.equal(await evalExpr(s, `window.td.place(55, ${y})`), true, `neck barrel at row ${y} places`);
  }
  const goldBeforeSeal = await evalExpr(s, "window.td.state().gold");
  assert.equal(await evalExpr(s, "window.td.place(55, 22)"), false, "the barrel that seals the goal is refused");
  assert.equal(await evalExpr(s, "window.td.state().gold"), goldBeforeSeal, "a refused barrel spends no gold");
  assert.equal(await evalExpr(s, "window.td.obstacles()"), 6, "the refused barrel is not tracked (1 + 5 neck)");

  // — placeItem follows the same path, and refunds/economy still hold ————
  const goldBeforeBarrel = await evalExpr(s, "window.td.state().gold");
  assert.equal(await evalExpr(s, "window.td.placeItem('barrel_wood', 22, 22)"), true, "a barrel places on an open tile");
  assert.equal(await evalExpr(s, "window.td.obstacles()"), 7, "the placed barrel is tracked");
  assert.equal(await evalExpr(s, "window.td.state().gold"), goldBeforeBarrel - 10, "the barrel cost 10 gold");

  // The anti-wall-off rule applies through placeItem too.
  assert.equal(await evalExpr(s, "window.td.placeItem('barrel_wood', 55, 22)"), false, "a barrel that seals the goal is refused");
  assert.equal(await evalExpr(s, "window.td.state().gold"), goldBeforeBarrel - 10, "a refused barrel spends no gold");
  assert.equal(await evalExpr(s, "window.td.obstacles()"), 7, "a refused barrel is not tracked");

  // — A leak ends the run and raises the game-over screen ————————————————
  await evalExpr(s, "window.td.lose()");
  await waitFor(s, "getComputedStyle(document.getElementById('td-gameover')).display !== 'none'");
  assert.equal(await evalExpr(s, "window.td.state().phase"), "gameover");

  assert.deepEqual(errors, [], `no uncaught page exceptions: ${errors.join("; ")}`);
});
