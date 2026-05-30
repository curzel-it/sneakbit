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

  // Host starts the deathmatch (the party-panel button's action).
  await waitFor(session.host, "!!window.deathmatch");
  await evalExpr(session.host, "window.deathmatch.start()");

  // Host: in PvP, arena 1301, both players at 1000 HP, distinct corners.
  const hs = await waitFor(session.host, "(() => { const s = window.deathmatch.state(); return s.mode === 'pvp' && s.zoneId === 1301 && s.players.length >= 2 ? s : null; })()");
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
  const guestMode = await waitFor(session.guest, "(async () => { const g = await import('./js/gameMode.js?v=20260530e'); return g.getGameMode() === 'coop' ? 'coop' : null; })()");
  assert.equal(guestMode, "coop", "guest game mode self-heals to coop via snapshot");

  await sleep(100);
  assert.deepEqual(hostErrors, [], "host threw no exceptions");
});
