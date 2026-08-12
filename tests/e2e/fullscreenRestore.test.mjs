// E2E: fullscreen survives the reloads the game does to itself.
//
// "New game" (and "Clear cache", and a language change) wipes localStorage
// and re-enters the page with location.replace — and a navigation always
// drops fullscreen, so a player who started a new game from a fullscreen
// session landed back in a window. fullscreen.js now records the state on
// unload and asks for it back on the way in.
//
// Headless Chrome won't grant a real fullscreen request, which is also the
// interesting case: the boot-time ask has no user activation behind it, so
// the restore has to fall back to the player's next keypress. The test stubs
// requestFullscreen to count asks without granting them.

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
const KEY = "sneakbit.fullscreen.restore";

// Counts fullscreen asks without granting any, so isFullscreen() stays false
// and the gesture fallback is the one under test. Installed for every
// document in the tab, boot script included.
const STUB_REQUEST = `
  window.__fsAsks = 0;
  Element.prototype.requestFullscreen = function () { window.__fsAsks++; return Promise.resolve(); };
  Element.prototype.webkitRequestFullscreen = function () { window.__fsAsks++; };
`;

test("fullscreen is asked back after a self-inflicted reload", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { chrome, session: s } = await launchPage("/tmp/sb-e2e-fullscreen-restore");
  t.after(() => chrome.kill());
  t.after(() => s.close());
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB_REQUEST });

  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!window.__menuNav");
  assert.equal(await evalExpr(s, `sessionStorage.getItem(${JSON.stringify(KEY)})`), null, "nothing owed on a cold start");

  // Play in fullscreen, then let the page navigate away (what New game does).
  await evalExpr(s, `(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    window.dispatchEvent(new Event('pagehide'));
    return true;
  })()`);
  assert.equal(await evalExpr(s, `sessionStorage.getItem(${JSON.stringify(KEY)})`), "1", "the unload recorded the fullscreen state");

  // Reloading is the navigation New game performs; sessionStorage survives it.
  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!window.__menuNav");
  await sleep(100);
  const asksAtBoot = await evalExpr(s, `window.__fsAsks`);
  assert.ok(asksAtBoot >= 1, `boot asked for fullscreen back (asks=${asksAtBoot})`);
  // The ask wasn't granted (no user activation), so the debt is still owed —
  // it has to survive, since boot can chain further reloads of its own.
  assert.equal(await evalExpr(s, `sessionStorage.getItem(${JSON.stringify(KEY)})`), "1", "an ungranted restore stays owed");

  // The player's next real input is the activation the browser wanted.
  await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))`);
  await sleep(100);
  assert.ok(await evalExpr(s, `window.__fsAsks`) > asksAtBoot, "the first gesture asked again");
  assert.equal(await evalExpr(s, `sessionStorage.getItem(${JSON.stringify(KEY)})`), null, "one shot only — the debt is settled");

  // And a plain reload while windowed stays windowed.
  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!window.__menuNav");
  await sleep(100);
  assert.equal(await evalExpr(s, `window.__fsAsks`), 0, "no unasked-for fullscreen on a normal load");
});
