// E2E: controller presence UX. Drives the Gamepad API connection events
// with synthetic events (the listeners only read event.gamepad.index, so
// no real pad is needed) and asserts: connect → active device flips to
// gamepad; disconnect-while-on-gamepad → pause overlay appears; a key
// press → overlay clears and the device reverts to keyboard.

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
const overlayVisible = (s) =>
  evalExpr(s, `(() => { const el = document.getElementById('controller-disconnect'); return !!el && el.style.display !== 'none'; })()`);

test("controller connect/disconnect drives device + pause overlay", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9271, dataDir: "/tmp/sb-e2e-ctrlpresence" });
  t.after(() => chrome.kill());
  const page = (await getTargets(9271)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!window.__activeInputDevice");

  // Default on desktop: keyboard.
  assert.equal(await evalExpr(s, "window.__activeInputDevice()"), "keyboard");

  // Connect → gamepad becomes the active device (no settings step).
  await evalExpr(s, `window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: { index: 0 } }))`);
  assert.equal(await evalExpr(s, "window.__activeInputDevice()"), "gamepad");
  assert.equal(await overlayVisible(s), false);

  // Disconnect while playing on the pad → pause overlay.
  await evalExpr(s, `window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0 } }))`);
  await sleep(50);
  assert.equal(await overlayVisible(s), true, "disconnect should raise the pause overlay");

  // Any key resumes (keyboard is always valid) and reverts the device.
  // A trusted key event (via CDP) — synthetic keydowns are intentionally
  // ignored for device tracking so gamepad's synthetic Escape can't flip it.
  await s.send("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
  await s.send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w", windowsVirtualKeyCode: 87 });
  await sleep(50);
  assert.equal(await overlayVisible(s), false, "a key press should dismiss the overlay");
  assert.equal(await evalExpr(s, "window.__activeInputDevice()"), "keyboard");

  // A disconnect while on keyboard (idle pad) must NOT pause — toast only.
  await evalExpr(s, `window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 1 } }))`);
  await sleep(50);
  assert.equal(await overlayVisible(s), false, "disconnect while on keyboard should not pause");
});
