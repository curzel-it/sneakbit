// E2E: "Exit game", the pause menu's way out of the desktop build.
//
// Drives the real menu against a fake shell: the button only exists when the
// game is running inside the Steam/Electron wrapper, quitting is behind a
// confirm, and the save reaches the shell *before* the quit request — the app
// is gone a beat after it, so a write left in flight is a write lost.
//
// The one thing this can't reproduce is the process actually dying; the fake
// shell answers 204 and stays up (tests/quitApp.test.js covers the shutdown
// side).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession,
  evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startFakeShell } from "./fixtures/fakeShellServer.mjs";
import { startServers } from "./fixtures/servers.mjs";

const DESKTOP = { platform: "electron", mirror: null, legacy: null };

let shell;
let servers;
before(async () => {
  if (!findChrome()) return;
  shell = await startFakeShell({ envelope: DESKTOP });
  servers = await startServers();
});
after(() => {
  if (shell) shell.stop();
  if (servers) servers.stop();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s, code) => evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true }))`);
const click = (s, id) => evalExpr(s, `(() => { const b = document.getElementById(${JSON.stringify(id)}); if (!b) return false; b.click(); return true; })()`);
// offsetParent is null for a display:none button — the same test menuNav uses
// to decide what a controller can reach.
const visible = (s, id) => evalExpr(s, `(() => { const b = document.getElementById(${JSON.stringify(id)}); return !!b && b.offsetParent !== null; })()`);

async function openPauseMenu(s) {
  await key(s, "Escape");
  await sleep(80);
}

// The confirm's buttons are disabled for 180ms so the keypress that opened it
// can't carry through and answer it.
async function answerConfirm(s, id) {
  await waitFor(s, `!document.getElementById(${JSON.stringify(id)})?.disabled`, { timeoutMs: 3000 });
  await click(s, id);
  await sleep(150);
}

test("the desktop shell can be quit from the pause menu, save first", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ dataDir: "/tmp/sb-e2e-exit-game" });
  t.after(() => chrome.kill());
  const page = (await getTargets(chrome.port)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  await navigate(s, `${shell.appUrl}/`);
  await waitFor(s, "!!window.save", { timeoutMs: 30000 });
  await openPauseMenu(s);
  assert.equal(await visible(s, "menu-exit-game"), true, "the desktop build offers a way out");

  // Cancelling has to be free: the player keeps playing, nothing is asked to
  // quit, and the button works again afterwards.
  assert.equal(await click(s, "menu-exit-game"), true);
  await answerConfirm(s, "confirm-cancel");
  assert.equal(shell.quits.length, 0, "a cancelled exit quits nothing");
  assert.equal(await evalExpr(s, "document.getElementById('menu-exit-game').disabled"), false);

  await click(s, "menu-exit-game");
  await answerConfirm(s, "confirm-ok");
  await waitFor(s, "true", { timeoutMs: 1000 });
  await sleep(400);

  assert.equal(shell.quits.length, 1, "the shell was asked to close the app");
  assert.ok(shell.mirrorWrites.length >= 1, "the save was mirrored on the way out");
  assert.ok(
    shell.quits[0].mirrorWritesBefore >= 1,
    "the mirror write has to land before the quit — the process dies right after it"
  );
  const mirrored = JSON.parse(shell.mirrorWrites.at(-1));
  assert.equal(mirrored.kv.latest_zone, "1001", "and it carries the live save");
});

test("the web build has no exit button at all", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ dataDir: "/tmp/sb-e2e-exit-game-web" });
  t.after(() => chrome.kill());
  const page = (await getTargets(chrome.port)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  // Plain static server — no /__native/ routes, so no shell to quit.
  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!window.save", { timeoutMs: 30000 });
  await openPauseMenu(s);

  assert.equal(await evalExpr(s, "!!document.getElementById('menu-exit-game')"), true);
  assert.equal(await visible(s, "menu-exit-game"), false, "a tab can't close itself — don't offer");
});
