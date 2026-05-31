// E2E: realtime online PvP (deathmatch). Host + guest connect in co-op, the
// host starts a realtime PvP match; both travel to the arena (1301) at distinct
// corners with 1000 HP; the host kills the guest → last-player-standing resolves
// → the host broadcasts pvpResult and BOTH clients show the winner screen.
// Exercises the new mode end-to-end without needing pixel-perfect aim. Self-
// skips when Chrome isn't installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession } from "./fixtures/coopSession.mjs";

let servers;
before(async () => {
  if (!findChrome()) return; // tests below self-skip
  servers = await startServers({ staticPort: 8014, relayPort: 8104 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("realtime online PvP: arena, 1000 HP, kill → result on both clients", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    hostPort: 9271,
    guestPort: 9272,
    hostDir: "/tmp/sb-e2e-dm-host",
    guestDir: "/tmp/sb-e2e-dm-guest",
  });
  t.after(() => session.stop());

  const hostErrors = [];
  session.host.on("Runtime.exceptionThrown", (p) => hostErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  // Host starts the deathmatch (the party-panel button's action). Sample P1's
  // tile at frame cadence across the arena entry first: the arena has no
  // teleporters, so travelTo's spawn fallback is the map centre — players must
  // never be *shown* there (they're scattered to corners while the screen is
  // still black), so no arena frame should read centre (45,45).
  await waitFor(session.host, "!!window.deathmatch");
  await evalExpr(session.host, `
    window.__dmTrail = [];
    window.__dmSample = setInterval(() => {
      const s = window.deathmatch.state();
      const p = s.players && s.players[0];
      window.__dmTrail.push({ zone: s.zoneId, x: p && p.tileX, y: p && p.tileY });
    }, 16);
  `);
  await evalExpr(session.host, "window.deathmatch.start()");

  // Host: in PvP, arena 1301, both players at 1000 HP, distinct corners.
  const hs = await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return s.mode === 'pvp' && s.zoneId === 1301 && s.players.length >= 2 ? s : null; })()");

  // No "spawn at centre then jump to a corner" flash during arena entry.
  await evalExpr(session.host, "clearInterval(window.__dmSample)");
  const centerFrames = await evalExpr(session.host, "window.__dmTrail.filter((s) => s.zone === 1301 && s.x === 45 && s.y === 45).length");
  assert.equal(centerFrames, 0, "host is never shown at the arena centre during entry");
  assert.equal(hs.hp[0], 1000, "host starts at 1000 HP");
  assert.equal(hs.hp[1], 1000, "guest starts at 1000 HP (host-side)");
  const [a, b] = hs.players;
  const manhattan = Math.abs(a.tileX - b.tileX) + Math.abs(a.tileY - b.tileY);
  assert.ok(manhattan > 20, `players spawn far apart (manhattan=${manhattan})`);

  // Guest learns the arena (mirror zone) and its own HP scales to 1000.
  await waitFor(session.guest, "(window.__sb.m.getMirrorZone() && window.__sb.m.getMirrorZone().id === 1301) || null");
  const guestSelfHp = await waitFor(session.guest, "(() => { const id = window.__sb.o.getSelfPlayerId(); const mp = window.__sb.m.getMirrorPlayerById(id); return (mp && mp.hp >= 900) ? mp.hp : null; })()");
  assert.ok(guestSelfHp >= 900, `guest's own HP scaled to ~1000 (got ${guestSelfHp})`);

  // Host kills the guest → last one standing (host) wins.
  await evalExpr(session.host, "window.deathmatch.kill(1)");
  const result = await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return s.over ? s.result : null; })()");
  assert.equal(result.kind, "winner", "match resolved to a winner");
  assert.equal(result.playerIndex, 0, "host (P1) is the lone survivor");

  // Result screen appears on BOTH clients (host locally, guest via pvpResult).
  const hostModal = await waitFor(session.host, "(() => { const e = document.getElementById('gameover'); return e && e.style.display === 'flex'; })() || null");
  assert.equal(hostModal, true, "host shows the result screen");
  const guestModal = await waitFor(session.guest, "(() => { const e = document.getElementById('gameover'); return e && e.style.display === 'flex'; })() || null");
  assert.equal(guestModal, true, "guest shows the result screen (pvpResult)");
  // Guest's result screen is waiting-style (host-driven) — no dead-end button.
  const guestBtnHidden = await evalExpr(session.guest, "(() => { const b = document.getElementById('go-continue'); return !!b && b.style.display === 'none'; })()");
  assert.equal(guestBtnHidden, true, "guest result modal hides the Rematch button");

  // Host ends PvP → pvpEnd dismisses the guest's overlay and the guest's game
  // mode self-heals back to coop via the snapshot mode field.
  await evalExpr(session.host, "window.deathmatch.exit()");
  const guestModalGone = await waitFor(session.guest, "(() => { const e = document.getElementById('gameover'); return (!e || e.style.display === 'none') ? true : null; })()");
  assert.equal(guestModalGone, true, "guest result modal dismissed on host exit (pvpEnd)");
  const guestMode = await waitFor(session.guest, "(async () => { const g = await import('./js/gameMode.js?v=20260531c'); return g.getGameMode() === 'coop' ? 'coop' : null; })()");
  assert.equal(guestMode, "coop", "guest game mode self-heals to coop via snapshot");

  // Exit returns the party to the pre-match co-op zone (1001 here), not a
  // fixed hub — the host and the guest's mirror both leave the arena.
  const hostZone = await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return s.zoneId === 1001 ? s.zoneId : null; })()");
  assert.equal(hostZone, 1001, "host returns to the pre-PvP co-op zone, not Duskhaven");
  const guestMirrorZone = await waitFor(session.guest, "(window.__sb.m.getMirrorZone() && window.__sb.m.getMirrorZone().id === 1001) ? 1001 : null");
  assert.equal(guestMirrorZone, 1001, "guest mirror follows the host back to the co-op zone");

  await sleep(100);
  assert.deepEqual(hostErrors, [], "host threw no exceptions");
});

// The result screen's secondary action: "Back to single player". The host
// leaves the match straight from the dialog — exit() returns the party to the
// co-op world + tells guests (pvpEnd), then switchRole('offline') drops the
// session entirely. The host lands back in single player (out of the arena,
// runtime role offline) and the guest falls back to offline too.
test("realtime online PvP: 'Back to single player' drops the host to offline", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    hostPort: 9273,
    guestPort: 9274,
    hostDir: "/tmp/sb-e2e-dm2-host",
    guestDir: "/tmp/sb-e2e-dm2-guest",
  });
  t.after(() => session.stop());

  const hostErrors = [];
  session.host.on("Runtime.exceptionThrown", (p) => hostErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  // Start the match and resolve it (host kills guest → host wins).
  await waitFor(session.host, "!!window.deathmatch");
  await evalExpr(session.host, "window.deathmatch.start()");
  await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return s.mode === 'pvp' && s.zoneId === 1301 && s.players.length >= 2 ? s : null; })()");
  await evalExpr(session.host, "window.deathmatch.kill(1)");
  await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return s.over ? s.result : null; })()");

  // Host result screen now offers the secondary "Back to single player" button
  // (the guest's waiting-style screen still doesn't — only the host drives it).
  const leaveVisible = await waitFor(session.host, "(() => { const b = document.getElementById('go-leave'); return (b && b.style.display !== 'none') ? true : null; })()");
  assert.equal(leaveVisible, true, "host result modal shows the leave button");
  const guestLeaveHidden = await evalExpr(session.guest, "(() => { const b = document.getElementById('go-leave'); return !b || b.style.display === 'none'; })()");
  assert.equal(guestLeaveHidden, true, "guest result modal hides the leave button");

  // Click it once it's armed (350 ms guard against stale keystrokes).
  await waitFor(session.host, "(() => { const b = document.getElementById('go-leave'); return (b && !b.disabled) ? true : null; })()");
  await evalExpr(session.host, "document.getElementById('go-leave').click()");

  // Host drops to offline single player: out of the arena, runtime role offline,
  // result modal gone, no longer in pvp mode.
  const hostRole = await waitFor(session.host, "(async () => { const o = await import('./js/onlineMode.js?v=20260531c'); return o.getRuntimeRole() === 'offline' ? 'offline' : null; })()");
  assert.equal(hostRole, "offline", "host runtime role is offline");
  const hostLeftArena = await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return (s.zoneId && s.zoneId !== 1301) ? s.zoneId : null; })()");
  assert.notEqual(hostLeftArena, 1301, "host is teleported out of the PvP arena");
  const hostModalGone = await waitFor(session.host, "(() => { const e = document.getElementById('gameover'); return (!e || e.style.display === 'none') ? true : null; })()");
  assert.equal(hostModalGone, true, "host result modal is dismissed");

  // Guest follows host.close → falls back to offline single player.
  const guestRole = await waitFor(session.guest, "(async () => { const o = await import('./js/onlineMode.js?v=20260531c'); return o.getRuntimeRole() === 'offline' ? 'offline' : null; })()", { timeoutMs: 15000 });
  assert.equal(guestRole, "offline", "guest falls back to offline after the host leaves");

  await sleep(100);
  assert.deepEqual(hostErrors, [], "host threw no exceptions");
});
