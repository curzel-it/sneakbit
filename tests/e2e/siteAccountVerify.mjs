// One-off visual + functional verification for the website account UI.
// Not a .test.mjs (kept out of the suite) — run it directly:
//   node tests/e2e/siteAccountVerify.mjs
// Registers on the /account/ page, proves the session persists across reload,
// shows in that page's nav chip, AND is seen by the game at / (the shared
// login guarantee). Writes a screenshot to /tmp/sb-site-account.png.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import {
  findChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const q = (s) => JSON.stringify(s);

if (!findChrome()) { console.error("Chrome not found (set CHROME_PATH)"); process.exit(2); }

const dbPath = join(tmpdir(), `sb-verify-site-${process.pid}-${Date.now()}.db`);
process.env.JWT_SECRET = "verify-secret-0123456789abcdef0123456789";
process.env.DATABASE_PATH = dbPath;

const servers = await startServers();
const chrome = await launchChrome({ dataDir: "/tmp/sb-verify-site" });
let s;
const fail = (m) => { console.error("FAIL:", m); cleanup(); process.exit(1); };
function cleanup() {
  try { s && s.close(); } catch {}
  try { chrome.kill(); } catch {}
  try { servers.stop(); } catch {}
  try { rmSync(dbPath); } catch {}
}

try {
  const page = (await getTargets(chrome.port)).find((x) => x.type === "page");
  s = await connectSession(page.webSocketDebuggerUrl);

  const api = `http://127.0.0.1:${servers.relayPort}`;
  const email = `site-${Date.now()}@sneakbit.test`;
  const pass = "password1";

  const setVal = (sel, v) => evalExpr(s, `(()=>{const e=document.querySelector(${q(sel)});if(!e)return false;e.value=${q(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const click = (sel) => evalExpr(s, `(()=>{const e=document.querySelector(${q(sel)});if(!e)return false;e.click();return true;})()`);
  const visible = (sel) => evalExpr(s, `(()=>{const e=document.querySelector(${q(sel)});return !!e&&getComputedStyle(e).display!=='none';})()`);
  const text = (sel) => evalExpr(s, `(()=>{const e=document.querySelector(${q(sel)});return e?e.textContent:null;})()`);

  // 1. Account page renders the signin view.
  await navigate(s, `${servers.appUrl}/account/?api=${api}`);
  await waitFor(s, `!!document.querySelector('#account-app .account-card')`);
  if (!(await visible("[data-view=signin]"))) fail("signin view not visible on /account/");
  console.log("✓ /account/ renders the sign-in view");

  // 2. Register a fresh account.
  await click("[data-view=signin] button.account-link"); // "Create an account"
  await waitFor(s, `getComputedStyle(document.querySelector('[data-view=register]')).display!=='none'`);
  await setVal("[data-view=register] input[autocomplete=email]", email);
  await setVal("[data-view=register] input[autocomplete=nickname]", "Neo");
  await setVal("[data-view=register] input[autocomplete=new-password]", pass);
  await click("[data-view=register] button.account-primary");

  // 3. Lands on the account view, signed in.
  await waitFor(s, `getComputedStyle(document.querySelector('[data-view=account]')).display!=='none'`);
  const shownEmail = await text(".account-email");
  if (shownEmail !== email) fail(`account email mismatch: ${shownEmail}`);
  console.log(`✓ registered + landed on account view (${shownEmail})`);

  // Screenshot the signed-in account page.
  const shot = await s.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/sb-site-account.png", Buffer.from(shot.data, "base64"));
  console.log("✓ screenshot -> /tmp/sb-site-account.png");

  // 4. Reload — session persists (same localStorage key).
  await navigate(s, `${servers.appUrl}/account/?api=${api}`);
  await waitFor(s, `getComputedStyle(document.querySelector('[data-view=account]')).display!=='none'`);
  console.log("✓ session persists across reload");

  // 5. The nav chip reflects the signed-in state.
  await waitFor(s, `(document.querySelector('#account-link')||{}).textContent?.includes('Account')`);
  console.log(`✓ nav chip: "${(await text('#account-link')).trim()}"`);

  // 6. The GAME at / sees the same session — the cross-surface guarantee.
  await navigate(s, `${servers.appUrl}/?api=${api}`);
  const signedInGame = await waitFor(s, `window.account && window.account.isSignedIn()`, { timeoutMs: 20000 });
  if (!signedInGame) fail("/ did not see the website session");
  console.log(`✓ / is signed in as ${(await evalExpr(s, `window.account.user().email`))}`);

  console.log("\nALL CHECKS PASSED");
  cleanup();
  process.exit(0);
} catch (e) {
  console.error(e);
  fail(e.message);
}
