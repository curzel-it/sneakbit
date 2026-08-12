// E2E: Escape has to reach the game while we're fullscreen.
//
// Escape is the pause-menu key (keyBindings DEFAULT_P1.menu), but the
// browser claims it in fullscreen: pressing it dropped the player out of
// fullscreen and the menu never opened. fullscreen.js now takes a
// Keyboard Lock on Escape for as long as the document is fullscreen, and
// releases it on the way out (press-and-hold Escape remains the browser's
// own escape hatch, so nobody gets trapped).
//
// navigator.keyboard is stubbed rather than driven for real: headless
// Chrome won't grant a genuine fullscreen request, and the lock is only
// observable through the API call anyway.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchPage, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers();
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Records lock/unlock calls instead of performing them. Installed for
// every document in the tab so it's in place before the boot script runs.
const STUB_KEYBOARD = `
  window.__kbLocks = [];
  window.__kbUnlocks = 0;
  Object.defineProperty(navigator, 'keyboard', {
    configurable: true,
    value: {
      lock: (keys) => { window.__kbLocks.push(Array.from(keys || [])); return Promise.resolve(); },
      unlock: () => { window.__kbUnlocks++; },
    },
  });
`;

// Fake the browser's side of a fullscreen enter/exit: swap
// document.fullscreenElement and fire the event fullscreen.js listens on.
const setFullscreen = (on) => `(() => {
  Object.defineProperty(document, 'fullscreenElement', {
    value: ${on ? "document.documentElement" : "null"}, configurable: true,
  });
  document.dispatchEvent(new Event('fullscreenchange'));
  return true;
})()`;

test("Escape is captured for the game while fullscreen, released on exit", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { chrome, session: s } = await launchPage("/tmp/sb-e2e-fullscreen-escape");
  t.after(() => chrome.kill());
  t.after(() => s.close());
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB_KEYBOARD });

  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!window.__menuNav");

  // Windowed: nothing to capture — Escape already reaches the page.
  assert.deepEqual(await evalExpr(s, "window.__kbLocks"), [], "no lock taken while windowed");

  await evalExpr(s, setFullscreen(true));
  await sleep(50);
  assert.deepEqual(await evalExpr(s, "window.__kbLocks"), [["Escape"]],
    "entering fullscreen locks Escape to the page");

  // …and it still does what the player expects with it.
  assert.equal(await evalExpr(s, `(async () => (await import('./js/menu.js')).isMenuOpen())()`), false);
  await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })) || true`);
  await sleep(50);
  assert.equal(await evalExpr(s, `(async () => (await import('./js/menu.js')).isMenuOpen())()`), true,
    "Escape opened the pause menu instead of leaving fullscreen");

  const unlocksBefore = await evalExpr(s, "window.__kbUnlocks");
  await evalExpr(s, setFullscreen(false));
  await sleep(50);
  assert.ok(await evalExpr(s, "window.__kbUnlocks") > unlocksBefore,
    "leaving fullscreen hands Escape back to the browser");
  assert.equal((await evalExpr(s, "window.__kbLocks")).length, 1, "no second lock on the way out");
});
