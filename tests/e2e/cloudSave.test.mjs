// End-to-end cloud-save sync across two independent browser profiles sharing
// one account + a live auth/saves server. Proves the headline behaviour:
//   - Device A registers, makes progress, and it lands in the cloud.
//   - Device B (a separate Chrome profile = separate localStorage) signs into
//     the same account and PULLS A's progress (first-adoption pull).
//   - A makes more progress; B reconciles and pulls the update (synced-device
//     pull). Conflict resolution itself is unit-tested in cloudSaveDecide /
//     savesRoutes; this exercises the real wiring end to end.

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

const STATIC_PORT = 8007;
const RELAY_PORT = 8098;
const CHROME_A = 9264;
const CHROME_B = 9265;
const CHROME_C = 9266;
const CHROME_D = 9267;
const EMAIL = "cloud-e2e@sneakbit.test";
const EMAIL2 = "cloud-conflict-e2e@sneakbit.test";
const PASS = "password1";

let servers;
let dbPath;

before(async () => {
  if (!findChrome()) return;
  dbPath = join(tmpdir(), `sb-e2e-cloud-${process.pid}-${Date.now()}.db`);
  // >=32 bytes so it clears the boot-time JWT_SECRET strength check.
  process.env.JWT_SECRET = "e2e-cloud-secret-0123456789abcdef0123456789";
  process.env.DATABASE_PATH = dbPath;
  servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
});

after(() => {
  if (servers) servers.stop();
  if (dbPath) { try { rmSync(dbPath); } catch { /* ignore */ } }
});

const q = (s) => JSON.stringify(s);
const setVal = (s, sel, v) =>
  evalExpr(s, `(()=>{const el=document.querySelector(${q(sel)});if(!el)return false;el.value=${q(v)};el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
const clickSel = (s, sel) =>
  evalExpr(s, `(()=>{const el=document.querySelector(${q(sel)});if(!el)return false;el.click();return true;})()`);
// Click the conflict-prompt button whose label contains `text`.
const clickConflictBtn = (s, text) =>
  evalExpr(s, `(()=>{const o=document.getElementById('cloud-conflict-overlay');if(!o)return false;`
    + `const b=[...o.querySelectorAll('button')].find(x=>x.textContent.includes(${q(text)}));`
    + `if(!b)return false;b.click();return true;})()`);

async function openDevice(port, dataDir, t) {
  const chrome = await launchChrome({ port, dataDir });
  t.after(() => chrome.kill());
  const targets = await getTargets(port);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());
  return s;
}

test("two devices on one account: progress syncs across them", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const url = `${servers.appUrl}/play/?api=http://127.0.0.1:${RELAY_PORT}`;

  // — Device A: register, make progress, push to cloud —————————————————
  const a = await openDevice(CHROME_A, "/tmp/sb-e2e-cloud-a", t);
  await navigate(a, url);
  await waitFor(a, "!!window.account && !!window.coop && !!window.cloudSave");
  await evalExpr(a, "window.account.open('register')");
  await setVal(a, '[data-view="register"] input[type="email"]', EMAIL);
  await setVal(a, '[data-view="register"] input[type="password"]', PASS);
  await clickSel(a, '[data-view="register"] button.account-primary');
  await waitFor(a, "window.account.isSignedIn()");
  // The register-triggered reconcile seeds the cloud; wait for that.
  await waitFor(a, "(window.cloudSave.meta().rev || 0) >= 1");

  // Unlock a skill (a kv write) and push it.
  await evalExpr(a, "window.skills.unlock('piercing')");
  await evalExpr(a, "window.cloudSave.flush().then(()=>true)");
  await waitFor(a, "(window.cloudSave.meta().rev || 0) >= 2");
  assert.equal(await evalExpr(a, "window.skills.get().piercing"), true);

  // — Device B: sign in, adopt the account's progress (first pull) ———————
  const b = await openDevice(CHROME_B, "/tmp/sb-e2e-cloud-b", t);
  await navigate(b, url);
  await waitFor(b, "!!window.account && !!window.coop && !!window.cloudSave");
  assert.equal(await evalExpr(b, "window.skills.get().piercing"), false, "B starts fresh");
  await evalExpr(b, "window.account.open('signin')");
  await setVal(b, '[data-view="signin"] input[type="email"]', EMAIL);
  await setVal(b, '[data-view="signin"] input[type="password"]', PASS);
  await clickSel(b, '[data-view="signin"] button.account-primary');
  // Sign-in → reconcile → pull → reload. Wait for the pulled progress.
  await waitFor(b, "window.account.isSignedIn() && window.skills.get().piercing === true", { timeoutMs: 20000 });

  // — Device A advances again; B reconciles and pulls the update ————————
  await evalExpr(a, "window.skills.unlock('catcher')");
  await evalExpr(a, "window.cloudSave.flush().then(()=>true)");
  await waitFor(a, "(window.cloudSave.meta().rev || 0) >= 3");

  // Trigger a reconcile on B (fire-and-forget — it reloads on pull).
  await evalExpr(b, "window.cloudSave.reconcile(); true", { awaitPromise: false });
  await waitFor(b, "window.skills.get().catcher === true", { timeoutMs: 20000 });
  // And the earlier progress is still present after the second pull.
  assert.equal(await evalExpr(b, "window.skills.get().piercing"), true);
});

test("first sign-in with genuine offline progress prompts; 'Keep this device' pushes local over the account", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const url = `${servers.appUrl}/play/?api=http://127.0.0.1:${RELAY_PORT}`;

  // — Device C: register an account and seed it with 'piercing' ————————————
  const c = await openDevice(CHROME_C, "/tmp/sb-e2e-cloud-c", t);
  await navigate(c, url);
  await waitFor(c, "!!window.account && !!window.cloudSave");
  await evalExpr(c, "window.account.open('register')");
  await setVal(c, '[data-view="register"] input[type="email"]', EMAIL2);
  await setVal(c, '[data-view="register"] input[type="password"]', PASS);
  await clickSel(c, '[data-view="register"] button.account-primary');
  await waitFor(c, "window.account.isSignedIn()");
  await waitFor(c, "(window.cloudSave.meta().rev || 0) >= 1");
  await evalExpr(c, "window.skills.unlock('piercing')");
  await evalExpr(c, "window.cloudSave.flush().then(()=>true)");
  await waitFor(c, "(window.cloudSave.meta().rev || 0) >= 2");

  // — Device D: make DIFFERENT genuine offline progress BEFORE signing in ——
  const d = await openDevice(CHROME_D, "/tmp/sb-e2e-cloud-d", t);
  await navigate(d, url);
  await waitFor(d, "!!window.account && !!window.cloudSave");
  // Real offline progress on this device — a skill the account doesn't have.
  await evalExpr(d, "window.skills.unlock('catcher')");
  await evalExpr(d, "window.account.open('signin')");
  await setVal(d, '[data-view="signin"] input[type="email"]', EMAIL2);
  await setVal(d, '[data-view="signin"] input[type="password"]', PASS);
  await clickSel(d, '[data-view="signin"] button.account-primary');

  // Sign-in reconcile sees genuine offline progress diverging from the
  // account → it must NOT silently clobber either side. A conflict prompt
  // appears instead of an automatic pull.
  await waitFor(d, "!!document.getElementById('cloud-conflict-overlay')", { timeoutMs: 20000 });
  // The account's progress has NOT been adopted while the prompt is open.
  assert.equal(await evalExpr(d, "window.skills.get().piercing"), false, "no auto-pull while prompting");
  assert.equal(await evalExpr(d, "window.skills.get().catcher"), true, "local progress untouched while prompting");

  // Choose to keep this device → push local over the account.
  assert.equal(await clickConflictBtn(d, "Keep this device"), true, "Keep-this-device button clicked");
  // The prompt closes and local progress is preserved (no reload, no pull).
  await waitFor(d, "!document.getElementById('cloud-conflict-overlay')");
  await waitFor(d, "(window.cloudSave.meta().rev || 0) >= 3", { timeoutMs: 20000 });
  assert.equal(await evalExpr(d, "window.skills.get().catcher"), true, "kept this device's catcher");
  assert.equal(await evalExpr(d, "window.skills.get().piercing"), false, "account's piercing was not pulled");

  // — Device C reconciles: it now adopts D's pushed save (catcher, no piercing) —
  await evalExpr(c, "window.cloudSave.reconcile(); true", { awaitPromise: false });
  await waitFor(c, "window.skills.get().catcher === true", { timeoutMs: 20000 });
  assert.equal(await evalExpr(c, "window.skills.get().piercing"), false,
    "C adopts D's kept-device save wholesale (piercing overwritten)");
});
