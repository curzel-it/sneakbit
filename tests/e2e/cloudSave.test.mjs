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
const EMAIL = "cloud-e2e@sneakbit.test";
const PASS = "password1";

let servers;
let dbPath;

before(async () => {
  if (!findChrome()) return;
  dbPath = join(tmpdir(), `sb-e2e-cloud-${process.pid}-${Date.now()}.db`);
  process.env.JWT_SECRET = "e2e-cloud-secret";
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
  const url = `${servers.appUrl}/index.html?api=http://127.0.0.1:${RELAY_PORT}`;

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
