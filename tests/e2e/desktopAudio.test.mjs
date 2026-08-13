// E2E: the desktop build launches with sound on.
//
// A browser tab is one of twenty and can't be trusted to make noise
// unprompted, so the web (and both mobile shells) start muted behind an
// onboarding toast. The Steam/Electron app was launched on purpose and owns
// its window — it starts audible and says nothing. Same first launch, same
// code, two answers; the only difference is the shell envelope.

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

// The persisted blob, not the live object: what a first launch writes is what
// the second launch reads back.
const storedMuted = (s) => evalExpr(
  s,
  "JSON.parse(localStorage.getItem('sneakbit.settings.v1') || '{}').muted"
);

const toastText = (s) => evalExpr(s, "document.getElementById('toast')?.textContent || ''");

// The settings panel reads the live settings object, so its checkbox is the
// player-visible proof that the default reached the runtime and not just disk.
async function menuMuteChecked(s) {
  await evalExpr(s, "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))");
  await sleep(120);
  // The widgets sync when the Settings panel opens, not when the menu does.
  assert.equal(await evalExpr(s, "!!document.getElementById('menu-open-settings')"), true);
  await evalExpr(s, "document.getElementById('menu-open-settings').click()");
  await sleep(120);
  return evalExpr(s, "document.getElementById('opt-muted').checked");
}

async function bootFresh(t, url, dataDir) {
  const chrome = await launchChrome({ dataDir });
  t.after(() => chrome.kill());
  const page = (await getTargets(chrome.port)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());
  await navigate(s, `${url}/`);
  await waitFor(s, "!!window.save", { timeoutMs: 30000 });
  // applyFirstLaunch schedules its toast 500ms in — wait past that so the
  // "no toast" assertion is a real absence rather than a race.
  await sleep(900);
  return s;
}

test("a first launch inside the desktop shell is unmuted and silent about it", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const s = await bootFresh(t, shell.appUrl, "/tmp/sb-e2e-desktop-audio");

  assert.equal(await storedMuted(s), false, "the desktop app starts with sound on");
  assert.ok(
    !(await toastText(s)).includes("muted"),
    "nothing to explain when audio just works"
  );
  assert.equal(await menuMuteChecked(s), false, "and the settings panel agrees");
});

test("a first visit on the web still starts muted, with the hint", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const s = await bootFresh(t, servers.appUrl, "/tmp/sb-e2e-web-audio");

  assert.equal(await storedMuted(s), true, "a tab stays quiet until asked");
  assert.match(await toastText(s), /muted/i, "and the player is told where to change it");
  assert.equal(await menuMuteChecked(s), true);
});
