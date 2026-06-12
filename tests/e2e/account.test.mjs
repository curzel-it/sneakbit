// End-to-end account flow through the real DOM panel + a live relay with
// auth enabled: register → reload (session persists) → sign out → sign in,
// then the offline guarantee — with the auth server unreachable the game
// still boots and a sign-in attempt reports "offline" instead of hanging.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  findChrome, skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8006;
const RELAY_PORT = 8096;
const CHROME_PORT = 9263;
const EMAIL = "e2e@sneakbit.test";
const PASS = "password1";
const NEWNAME = "Trinity";

let servers;
let dbPath;

before(async () => {
  if (!findChrome()) return;
  // Enable auth on the spawned relay: a test secret + a throwaway DB file.
  // >=32 bytes so it clears the boot-time JWT_SECRET strength check.
  dbPath = join(tmpdir(), `sb-e2e-account-${process.pid}-${Date.now()}.db`);
  process.env.JWT_SECRET = "e2e-test-secret-0123456789abcdef0123456789";
  process.env.DATABASE_PATH = dbPath;
  servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
});

after(() => {
  if (servers) servers.stop();
  if (dbPath) { try { rmSync(dbPath); } catch { /* ignore */ } }
});

const q = (s) => JSON.stringify(s);
async function setVal(s, selector, val) {
  return evalExpr(s, `(()=>{const el=document.querySelector(${q(selector)});if(!el)return false;el.value=${q(val)};el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
}
async function clickSel(s, selector) {
  return evalExpr(s, `(()=>{const el=document.querySelector(${q(selector)});if(!el)return false;el.click();return true;})()`);
}

test("register, persist across reload, sign out, sign in, and stay playable offline", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-account" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const liveUrl = `${servers.appUrl}/play/?api=http://127.0.0.1:${RELAY_PORT}`;

  // — Boot, then register —————————————————————————————————————————————
  await navigate(s, liveUrl);
  await waitFor(s, "!!window.account && !!window.coop");
  assert.equal(await evalExpr(s, "window.account.isSignedIn()"), false);

  await evalExpr(s, "window.account.open('register')");
  await setVal(s, '[data-view="register"] input[type="email"]', EMAIL);
  await setVal(s, '[data-view="register"] input[type="text"]', NEWNAME);
  await setVal(s, '[data-view="register"] input[type="password"]', PASS);
  await clickSel(s, '[data-view="register"] button.account-primary');
  await waitFor(s, "window.account.isSignedIn()");
  assert.equal(await evalExpr(s, "window.account.user().email"), EMAIL);
  assert.equal(await evalExpr(s, "window.account.user().displayName"), NEWNAME);

  // — Reload: the session persists from localStorage ——————————————————
  await navigate(s, liveUrl);
  await waitFor(s, "!!window.account && !!window.coop");
  assert.equal(await evalExpr(s, "window.account.isSignedIn()"), true);
  assert.equal(await evalExpr(s, "window.account.user().email"), EMAIL);

  // — Sign out ————————————————————————————————————————————————————————
  await evalExpr(s, "window.account.open('account')");
  await clickSel(s, '[data-view="account"] button.account-danger');
  await waitFor(s, "(!window.account.isSignedIn())");

  // — Sign back in ————————————————————————————————————————————————————
  await evalExpr(s, "window.account.open('signin')");
  await setVal(s, '[data-view="signin"] input[type="email"]', EMAIL);
  await setVal(s, '[data-view="signin"] input[type="password"]', PASS);
  await clickSel(s, '[data-view="signin"] button.account-primary');
  await waitFor(s, "window.account.isSignedIn()");

  // — Offline guarantee: auth server unreachable —————————————————————
  // Point the API at a dead port. The game must still boot and play, and a
  // sign-in attempt must surface a friendly offline message (not hang or
  // throw). The cached session is preserved across the failed revalidate.
  await navigate(s, `${servers.appUrl}/play/?api=http://127.0.0.1:9`);
  await waitFor(s, "!!window.coop");
  const positions = await evalExpr(s, "window.coop.positions()");
  assert.ok(Array.isArray(positions) && positions.length >= 1, "game world is live with the auth server down");
  assert.equal(await evalExpr(s, "window.account.isSignedIn()"), true, "cached session survives an offline revalidate");

  await evalExpr(s, "window.account.open('signin')");
  await setVal(s, '[data-view="signin"] input[type="email"]', EMAIL);
  await setVal(s, '[data-view="signin"] input[type="password"]', PASS);
  await clickSel(s, '[data-view="signin"] button.account-primary');
  const errText = await waitFor(
    s,
    `(()=>{const e=document.querySelector('[data-view="signin"] .account-error');return e&&e.style.display!=='none'?e.textContent:null;})()`,
  );
  assert.match(errText, /offline/i);
});

test("change display name through the editName sub-view", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9268, dataDir: "/tmp/sb-e2e-account-name" });
  t.after(() => chrome.kill());
  const targets = await getTargets(9268);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const email = "e2e-name@sneakbit.test";
  const liveUrl = `${servers.appUrl}/play/?api=http://127.0.0.1:${RELAY_PORT}`;
  const clickText = (scope, text) =>
    evalExpr(s, `(()=>{const el=[...document.querySelectorAll(${q(scope)})].find(e=>e.textContent.trim()===${q(text)});if(!el)return false;el.click();return true;})()`);
  const shown = (view) =>
    `(()=>{const v=document.querySelector('[data-view="${view}"]');return !!v&&v.style.display!=='none';})()`;

  await navigate(s, liveUrl);
  await waitFor(s, "!!window.account && !!window.coop");

  // Register with no display name, then set one via the dedicated sub-view.
  await evalExpr(s, "window.account.open('register')");
  await setVal(s, '[data-view="register"] input[type="email"]', email);
  await setVal(s, '[data-view="register"] input[type="password"]', PASS);
  await clickSel(s, '[data-view="register"] button.account-primary');
  await waitFor(s, "window.account.isSignedIn()");

  // Account view → "Change display name" button opens the editName sub-view.
  await evalExpr(s, "window.account.open('account')");
  await clickText('[data-view="account"] button.account-action', "Change display name");
  await waitFor(s, shown("editName"));
  await setVal(s, '[data-view="editName"] input[type="text"]', NEWNAME);
  await clickSel(s, '[data-view="editName"] button.account-primary');

  // On success it saves and returns to the account view.
  await waitFor(s, `window.account.user().displayName === ${q(NEWNAME)}`);
  await waitFor(s, shown("account"));
});

test("delete account removes it server-side and signs the user out", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9266, dataDir: "/tmp/sb-e2e-account-del" });
  t.after(() => chrome.kill());
  const targets = await getTargets(9266);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const email = "e2e-del@sneakbit.test";
  const liveUrl = `${servers.appUrl}/play/?api=http://127.0.0.1:${RELAY_PORT}`;
  const clickText = (scope, text) =>
    evalExpr(s, `(()=>{const el=[...document.querySelectorAll(${q(scope)})].find(e=>e.textContent.trim()===${q(text)});if(!el)return false;el.click();return true;})()`);

  await navigate(s, liveUrl);
  await waitFor(s, "!!window.account && !!window.coop");

  // Register.
  await evalExpr(s, "window.account.open('register')");
  await setVal(s, '[data-view="register"] input[type="email"]', email);
  await setVal(s, '[data-view="register"] input[type="password"]', PASS);
  await clickSel(s, '[data-view="register"] button.account-primary');
  await waitFor(s, "window.account.isSignedIn()");

  // Delete: open account → reveal danger zone → confirm with password.
  await evalExpr(s, "window.account.open('account')");
  await clickText('[data-view="account"] button', "Delete account");
  await setVal(s, '[data-view="account"] .account-delete-confirm input[type="password"]', PASS);
  await clickText('[data-view="account"] button', "Permanently delete");
  await waitFor(s, "(!window.account.isSignedIn()) && window.account.user() === null", { timeoutMs: 20000 });

  // Server-side gone: signing in again fails with invalid credentials.
  await evalExpr(s, "window.account.open('signin')");
  await setVal(s, '[data-view="signin"] input[type="email"]', email);
  await setVal(s, '[data-view="signin"] input[type="password"]', PASS);
  await clickSel(s, '[data-view="signin"] button.account-primary');
  const err = await waitFor(
    s,
    `(()=>{const e=document.querySelector('[data-view="signin"] .account-error');return e&&e.style.display!=='none'?e.textContent:null;})()`,
  );
  assert.match(err, /wrong email or password/i);
});
