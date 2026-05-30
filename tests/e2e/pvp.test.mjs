// E2E: local turn-based PvP. Starts a 2-player match through the real
// startPvpMatch path (window.pvp debug hook), then asserts the whole loop:
// mode + arena + 1000 HP, corner spawns, the prep→active turn flip, turn-
// gated input (only the active player's slot reacts), and win/lose (killing
// one player resolves the match to the survivor and raises the result
// modal). Self-skips when Chrome isn't installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8005, relayPort: 8095 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const posOf = (list, index) => list.find((p) => p.index === index);

test("local PvP: arena, corners, turns, gating, win/lose", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9262, dataDir: "/tmp/sb-e2e-pvp" });
  t.after(() => chrome.kill());
  const targets = await getTargets(9262);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!(window.pvp && window.coop)");

  // Start a 2-player match and wait for the arena + PvP mode + 1000 HP.
  await evalExpr(s, "window.pvp.start(2)");
  const started = await waitFor(s, "(() => { const st = window.pvp.state(); return st.mode === 'pvp' && st.zoneId === 1301 ? st : null; })()");
  assert.equal(started.hp[0], 1000, "P1 starts at 1000 HP in PvP");
  assert.equal(started.hp[1], 1000, "P2 starts at 1000 HP in PvP");

  // Two avatars, spawned far apart (opposite corners of the arena).
  const spawns = await evalExpr(s, "window.coop.positions()");
  assert.equal(spawns.length, 2, "two avatars in the arena");
  const a = posOf(spawns, 0), b = posOf(spawns, 1);
  const manhattan = Math.abs(a.tileX - b.tileX) + Math.abs(a.tileY - b.tileY);
  assert.ok(manhattan > 20, `players spawn far apart (manhattan=${manhattan})`);

  // Match opens on P1's prep (nobody acts), then flips to P1's active turn.
  const prep = await evalExpr(s, "window.pvp.state().turn");
  assert.equal(prep.kind, "prep", "match opens in prep");
  assert.equal(prep.playerIndex, 0, "prep is for P1");
  await waitFor(s, "window.pvp.state().turn.kind === 'player'");
  const active = await evalExpr(s, "window.pvp.state().turn");
  assert.equal(active.playerIndex, 0, "P1 is the first active player");

  // Turn-gated input: during P1's turn, only slot 1 reacts. Tap a facing
  // the avatar isn't already at and assert P1 rotates while P2 is frozen.
  const before = await evalExpr(s, "window.coop.positions()");
  const p1dir = posOf(before, 0).direction;
  const p2dir = posOf(before, 1).direction;
  const target = p1dir === "up" ? "down" : "up";

  await evalExpr(s, `window.coop.tap(2, ${JSON.stringify(target)})`); // off-turn
  await evalExpr(s, `window.coop.tap(1, ${JSON.stringify(target)})`); // on-turn
  await sleep(250);

  const afterTap = await evalExpr(s, "window.coop.positions()");
  assert.equal(posOf(afterTap, 0).direction, target, "active P1 turned to face the tap");
  assert.equal(posOf(afterTap, 1).direction, p2dir, "off-turn P2 ignored its tap");

  // Win/lose: kill P2 → P1 is the lone survivor; the match resolves and the
  // result modal appears.
  await evalExpr(s, "window.pvp.kill(1)");
  const result = await waitFor(s, "(() => { const st = window.pvp.state(); return st.over ? st.result : null; })()");
  assert.deepEqual(result, { kind: "winner", playerIndex: 0 }, "P1 wins the match");
  const modalShown = await evalExpr(s, "(() => { const el = document.getElementById('gameover'); return !!el && el.style.display === 'flex'; })()");
  assert.equal(modalShown, true, "match-result modal is visible");

  assert.deepEqual(errors, [], "page threw no exceptions");
});
