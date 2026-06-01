// E2E: local realtime PvP. Starts a 2-player match through the real
// startPvpMatch path (window.pvp debug hook), then asserts the whole loop:
// mode + arena + 1000 HP, corner spawns, split-screen (one slice per player),
// simultaneous input (both players act at once — no turns), scavenge ammo
// pickups, firing, and win/lose (killing one player resolves the match to the
// survivor, raises the result modal, and freezes the winner). Self-skips when
// Chrome isn't installed.

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

test("local realtime PvP: arena, corners, simultaneous input, scavenge, win/lose", async (t) => {
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

  // ...and in corners, not on the sides. The arena (1301) is 90×90 with its
  // centre near (45,45); a corner pocket sits far from centre on BOTH axes,
  // whereas a mid-edge "side" spawn (the bug) is near-centre on one axis.
  const CX = 45, CY = 45, EDGE = 20;
  for (const p of [a, b]) {
    assert.ok(
      Math.abs(p.tileX - CX) > EDGE && Math.abs(p.tileY - CY) > EDGE,
      `player ${p.index} spawns in a corner, not a side (tile ${p.tileX},${p.tileY})`,
    );
  }

  // Local PvP is split-screen: one viewport slice per player on this device
  // (the same layout local co-op uses), not a single shared/averaged camera.
  const slices = await evalExpr(s, "window.coop.slices()");
  assert.equal(slices.length, 2, "2-player local PvP carves the canvas into 2 slices");

  // Realtime: both players act at once. Tap each to a distinct facing and
  // assert BOTH rotate the same frame — there's no turn gate.
  await evalExpr(s, `window.coop.tap(1, "up")`);
  await evalExpr(s, `window.coop.tap(2, "down")`);
  await sleep(250);
  const afterTap = await evalExpr(s, "window.coop.positions()");
  assert.equal(posOf(afterTap, 0).direction, "up", "P1 turned to face its tap");
  assert.equal(posOf(afterTap, 1).direction, "down", "P2 turned to face its tap simultaneously");

  // Ammo HUD is per-slice: one chip per player, each tagged and anchored into
  // its own slice (distinct x), instead of a single P1 chip floating top-right.
  const chips = await evalExpr(s, `(() => {
    return [...document.querySelectorAll('#ammo-hud .ammo-chip')]
      .filter((c) => c.style.display !== 'none')
      .map((c) => { const r = c.getBoundingClientRect(); return { text: c.textContent.trim(), left: Math.round(r.left) }; });
  })()`);
  assert.equal(chips.length, 2, "one ammo chip per player in split-screen PvP");
  assert.ok(chips.every((c) => /^P[12]\b/.test(c.text)), `each chip tagged with its player (${JSON.stringify(chips.map((c) => c.text))})`);
  assert.notEqual(chips[0].left, chips[1].left, "chips anchored to different slices (distinct x)");

  // Scavenge model: players spawn with only the kunai launcher and no ammo,
  // so nobody can fire until they pick some up.
  assert.deepEqual(await evalExpr(s, "window.pvp.state().weapon"), [1160, 1160, 1160, 1160], "everyone starts on the kunai launcher");
  assert.deepEqual(await evalExpr(s, "window.pvp.state().ammo"), [0, 0, 0, 0], "everyone starts empty");
  const dryDelta = await evalExpr(s, "(() => { const b0 = window.pvp.state().bullets; window.pvp.shoot(1); return window.pvp.state().bullets - b0; })()");
  assert.equal(dryDelta, 0, "no ammo → no shot");

  // Real map pickup: warp P1 onto a known kunai.x10 bundle tile (data/1301.json);
  // the next frame registers movement and the per-frame checkPickup collects it.
  await evalExpr(s, "window.pvp.warp(0, 14, 17)");
  await sleep(250);
  assert.equal(await evalExpr(s, "window.pvp.ammoOf(0, 7000)"), 10, "picked up 10 kunai from the map");
  assert.equal(await evalExpr(s, "window.pvp.ammoOf(1, 7000)"), 0, "only the picker gained ammo");

  // Per-caliber: grab .223 (AR15) ammo — it's a SEPARATE pool from kunai, and
  // doesn't change the equipped weapon, so the HUD count (current weapon) is
  // still kunai.
  await evalExpr(s, "window.pvp.warp(0, 39, 26)"); // ar15.bullet.x100 bundle
  await sleep(250);
  assert.equal(await evalExpr(s, "window.pvp.ammoOf(0, 1169)"), 100, "picked up 100 .223 rounds");
  assert.equal(await evalExpr(s, "window.pvp.ammoOf(0, 7000)"), 10, "kunai pool unchanged by the .223 pickup");
  assert.equal((await evalExpr(s, "window.pvp.state().ammo"))[0], 10, "HUD still shows kunai (equipped weapon)");

  // Pick up the AR15 weapon → equipped weapon swaps, and the HUD count follows
  // it to the .223 pool.
  await evalExpr(s, "window.pvp.warp(0, 40, 26)"); // ar15.item
  await sleep(250);
  assert.equal((await evalExpr(s, "window.pvp.state().weapon"))[0], 1154, "AR15 now equipped");
  assert.equal((await evalExpr(s, "window.pvp.state().ammo"))[0], 100, "HUD count follows to .223");

  // Realtime: P1 can fire immediately — no prep/turn to wait out. (The
  // simultaneous-tap above already proved the input gate is open for every
  // slot at once; firing draws on that same gate.)
  const p1Delta = await evalExpr(s, "(() => { const b0 = window.pvp.state().bullets; window.pvp.shoot(1); return window.pvp.state().bullets - b0; })()");
  assert.ok(p1Delta >= 1, "P1 fires the AR15");
  assert.equal(await evalExpr(s, "window.pvp.ammoOf(0, 1169)"), 99, ".223 spent");
  assert.equal(await evalExpr(s, "window.pvp.ammoOf(0, 7000)"), 10, "kunai pool untouched");

  // Win/lose: kill P2 → P1 is the lone survivor; the match resolves and the
  // result modal appears.
  await evalExpr(s, "window.pvp.kill(1)");
  const result = await waitFor(s, "(() => { const st = window.pvp.state(); return st.over ? st.result : null; })()");
  assert.deepEqual(result, { kind: "winner", playerIndex: 0 }, "P1 wins the match");
  const modalShown = await evalExpr(s, "(() => { const el = document.getElementById('gameover'); return !!el && el.style.display === 'flex'; })()");
  assert.equal(modalShown, true, "match-result modal is visible");

  // Match over freezes input: even the winner (with ammo to spare) can't fire.
  const frozenDelta = await evalExpr(s, "(() => { const b0 = window.pvp.state().bullets; window.pvp.shoot(1); return window.pvp.state().bullets - b0; })()");
  assert.equal(frozenDelta, 0, "no shots once the match is over");

  // Exit returns to the zone the match was started from (1001 on a fresh
  // save), back in co-op mode — never the arena, never the old Duskhaven hub.
  await evalExpr(s, "window.pvp.exit()");
  const exited = await waitFor(s, "(() => { const st = window.pvp.state(); return st.mode === 'coop' && st.zoneId === 1001 ? st : null; })()");
  assert.equal(exited.zoneId, 1001, "exit returns to the pre-PvP zone, not the arena/Duskhaven");

  assert.deepEqual(errors, [], "page threw no exceptions");
});
