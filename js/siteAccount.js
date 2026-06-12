// The marketing site's account-facing UI — the website counterpart to the
// in-game accountPanel.js. Two mount points, both self-wiring on load:
//
//   #account-link  -> mountAuthLink()    the "Sign in" / "Account · Name" chip
//                                         in the landing + account-page headers
//   #account-app   -> mountAccountPage()  the full /account/ page (sign in,
//                                         register, forgot/reset, profile edits,
//                                         delete, and a view-only purchase list)
//
// It reuses ONLY the framework-free data layer — accountSession.js (the shared
// localStorage session, same KEY the game uses, so a sign-in here is a sign-in
// in /play/ and vice versa), accountApi.js, storeApi.js, and dom.js's el(). It
// deliberately does NOT pull in the game runtime that accountPanel.js depends on
// (menuNav, skins/heroPreview sprite rendering, strings/data) — purchases are
// listed as plain text rows, and status is shown inline instead of via toast.js.
//
// Behavior (validation, error-code messages, offline/401 handling) mirrors
// accountPanel.js so the two surfaces stay consistent.

import {
  getUser, getToken, isSignedIn, setSession, updateUser, signOut,
  onAccountChange, revalidate, resolveResetToken,
} from "./accountSession.js";
import {
  registerAccount, loginAccount, updateMe, forgotPassword, resetPassword, deleteAccount,
} from "./accountApi.js";
import { fetchEntitlements } from "./storeApi.js";
import { el, showOnly } from "./dom.js";

// — Public mounts ————————————————————————————————————————————————————————

// The header chip. Reflects sign-in state and links to the account page. Lives
// on every marketing page (landing + account) so the entry point is always one
// click away and updates live via onAccountChange (incl. cross-tab storage sync).
export function mountAuthLink(container) {
  injectStyles();
  const render = (user) => {
    container.textContent = "";
    const label = user ? `Account · ${user.displayName || user.email}` : "Sign in";
    container.appendChild(el("a", { class: "site-auth-link", href: "/account/", text: label }));
  };
  render(getUser());
  onAccountChange(render);
  if (isSignedIn()) setTimeout(() => { revalidate().catch(() => {}); }, 0);
}

// The full account page. Builds every view once and toggles by display, exactly
// like accountPanel — minus the overlay chrome (this IS the page).
export function mountAccountPage(container) {
  injectStyles();
  buildPage(container);
  // Reset deep link (?reset=<token> from a password-reset email) opens straight
  // to the reset view; a signed-in visitor lands on their account; everyone else
  // on sign in.
  resetToken = resolveResetToken();
  if (resetToken) showView("reset");
  else if (isSignedIn()) { showView("account"); setTimeout(() => { revalidate().catch(() => {}); }, 0); }
  else showView("signin");

  // Keep the account view fresh if the session changes underfoot (revalidate,
  // or a sign-out in another tab via the storage listener).
  onAccountChange(() => {
    if (currentView === "account") renderAccountView();
    else if (!isSignedIn() && (currentView === "editName" || currentView === "editPassword")) showView("signin");
  });
}

// — State ————————————————————————————————————————————————————————————————

const views = {};
const w = {};            // per-view widget refs (inputs, error <p>, …)
let currentView = null;
let resetToken = null;
let purchasesReqId = 0;  // guards a slow entitlement fetch from clobbering a newer render

// — Build ————————————————————————————————————————————————————————————————

function buildPage(container) {
  views.signin = buildSigninView();
  views.register = buildRegisterView();
  views.forgot = buildForgotView();
  views.reset = buildResetView();
  views.account = buildAccountView();
  views.editName = buildEditNameView();
  views.editPassword = buildEditPasswordView();
  container.textContent = "";
  container.appendChild(el("div", { class: "account-card" }, Object.values(views)));
}

function viewRoot(name, title) {
  return el("div", { class: "account-view", dataset: { view: name }, style: { display: "none" } }, [
    el("h1", { text: title }),
  ]);
}

function field(root, { type = "text", placeholder, autocomplete, onEnter }) {
  const input = el("input", {
    class: "account-input", type, placeholder, autocomplete,
    on: onEnter
      ? { keydown: (e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } } }
      : undefined,
  });
  root.appendChild(input);
  return input;
}

function errorEl(root) {
  const p = el("p", { class: "account-error", style: { display: "none" } });
  root.appendChild(p);
  return p;
}

function primaryButton(root, label, handler) {
  const btn = el("button", { class: "account-primary", text: label, on: { click: handler } });
  root.appendChild(btn);
  return btn;
}

function linkRow(root, links) {
  root.appendChild(el("div", { class: "account-links" },
    links.map(({ label, view }) =>
      el("button", { class: "account-link", text: label, on: { click: () => showView(view) } }))));
}

function legalFooter(lead) {
  return el("p", {
    class: "account-legal",
    html: `${lead} ` +
      `<a href="/terms.html" target="_blank" rel="noopener">Terms</a> and ` +
      `<a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.`,
  });
}

function buildSigninView() {
  const root = viewRoot("signin", "Sign in");
  w.signinEmail = field(root, { type: "email", placeholder: "Email", autocomplete: "email", onEnter: onSignin });
  w.signinPassword = field(root, { type: "password", placeholder: "Password", autocomplete: "current-password", onEnter: onSignin });
  w.signinError = errorEl(root);
  w.signinBtn = primaryButton(root, "Sign in", onSignin);
  linkRow(root, [
    { label: "Create an account", view: "register" },
    { label: "Forgot password?", view: "forgot" },
  ]);
  return root;
}

function buildRegisterView() {
  const root = viewRoot("register", "Create account");
  root.appendChild(el("p", { class: "account-hint",
    text: "An account lets you sync progress and carry your purchases across devices and the game." }));
  w.regEmail = field(root, { type: "email", placeholder: "Email", autocomplete: "email" });
  w.regName = field(root, { type: "text", placeholder: "Display name (optional)", autocomplete: "nickname" });
  w.regPassword = field(root, { type: "password", placeholder: "Password (min 8 characters)", autocomplete: "new-password", onEnter: onRegister });
  w.regError = errorEl(root);
  w.regBtn = primaryButton(root, "Create account", onRegister);
  linkRow(root, [{ label: "Already have an account? Sign in", view: "signin" }]);
  root.appendChild(legalFooter("By creating an account you agree to the"));
  return root;
}

function buildForgotView() {
  const root = viewRoot("forgot", "Reset password");
  root.appendChild(el("p", { class: "account-hint",
    text: "Enter your email and we'll send a link to choose a new password." }));
  w.forgotEmail = field(root, { type: "email", placeholder: "Email", autocomplete: "email", onEnter: onForgot });
  w.forgotError = errorEl(root);
  w.forgotInfo = el("p", { class: "account-info", style: { display: "none" } });
  root.appendChild(w.forgotInfo);
  w.forgotBtn = primaryButton(root, "Send reset link", onForgot);
  linkRow(root, [{ label: "Back to sign in", view: "signin" }]);
  return root;
}

function buildResetView() {
  const root = viewRoot("reset", "Choose a new password");
  w.resetPassword = field(root, { type: "password", placeholder: "New password (min 8 characters)", autocomplete: "new-password", onEnter: onReset });
  w.resetError = errorEl(root);
  w.resetBtn = primaryButton(root, "Set new password", onReset);
  linkRow(root, [{ label: "Back to sign in", view: "signin" }]);
  return root;
}

function buildAccountView() {
  const root = viewRoot("account", "Account");
  w.accountBanner = el("p", { class: "account-info", style: { display: "none" } });
  root.appendChild(w.accountBanner);
  w.accountEmail = el("p", { class: "account-email" });
  root.appendChild(w.accountEmail);

  root.appendChild(el("button", { class: "account-action", text: "Change display name", on: { click: () => showView("editName") } }));
  root.appendChild(el("button", { class: "account-action", text: "Change password", on: { click: () => showView("editPassword") } }));
  w.accountError = errorEl(root);

  root.appendChild(el("p", { class: "account-hint", text: "Purchased items" }));
  w.accountPurchases = el("div", { class: "account-purchases" });
  root.appendChild(w.accountPurchases);

  root.appendChild(el("button", { class: "account-danger", text: "Sign out", on: { click: onSignOut } }));

  // Danger zone: delete behind a reveal + password confirm, same as in-game.
  root.appendChild(el("p", { class: "account-hint account-danger-label", text: "Danger zone" }));
  w.accountDeleteBtn = el("button", {
    class: "account-danger", text: "Delete account",
    on: { click: () => showDeleteConfirm(true) },
  });
  root.appendChild(w.accountDeleteBtn);

  w.accountDeletePw = el("input", {
    class: "account-input", type: "password",
    placeholder: "Enter your password to confirm", autocomplete: "current-password",
    on: { keydown: (e) => { if (e.key === "Enter") { e.preventDefault(); onDeleteAccount(); } } },
  });
  w.accountDeleteConfirmBtn = el("button", {
    class: "account-danger", text: "Permanently delete", on: { click: onDeleteAccount },
  });
  w.accountDeleteConfirm = el("div", { class: "account-delete-confirm", style: { display: "none" } }, [
    el("p", { class: "account-error", style: { display: "block" },
      text: "This permanently deletes your account and cloud save. This cannot be undone." }),
    w.accountDeletePw,
    w.accountDeleteConfirmBtn,
    el("button", { text: "Cancel", on: { click: () => showDeleteConfirm(false) } }),
  ]);
  root.appendChild(w.accountDeleteConfirm);

  root.appendChild(legalFooter("See our"));
  return root;
}

function buildEditNameView() {
  const root = viewRoot("editName", "Change display name");
  w.editName = field(root, { type: "text", placeholder: "Display name", autocomplete: "nickname", onEnter: onSaveProfile });
  w.editNameError = errorEl(root);
  w.editNameSaveBtn = primaryButton(root, "Save", onSaveProfile);
  linkRow(root, [{ label: "Back", view: "account" }]);
  return root;
}

function buildEditPasswordView() {
  const root = viewRoot("editPassword", "Change password");
  w.editCurrentPw = field(root, { type: "password", placeholder: "Current password", autocomplete: "current-password" });
  w.editNewPw = field(root, { type: "password", placeholder: "New password (min 8 characters)", autocomplete: "new-password", onEnter: onChangePassword });
  w.editPasswordError = errorEl(root);
  w.editPasswordSaveBtn = primaryButton(root, "Change password", onChangePassword);
  linkRow(root, [{ label: "Back", view: "account" }]);
  return root;
}

function showDeleteConfirm(on) {
  if (!w.accountDeleteConfirm) return;
  w.accountDeleteConfirm.style.display = on ? "block" : "none";
  w.accountDeleteBtn.style.display = on ? "none" : "block";
  if (!on && w.accountDeletePw) w.accountDeletePw.value = "";
}

// — View switching ——————————————————————————————————————————————————————

function showView(name) {
  currentView = name;
  showOnly(views, name);
  clearErrors();
  if (name === "account") renderAccountView();
  else if (name === "editName") renderEditNameView();
  else if (name === "editPassword") renderEditPasswordView();
}

function renderAccountView() {
  const user = getUser();
  if (!user) { showView("signin"); return; }
  w.accountEmail.textContent = user.email;
  showDeleteConfirm(false);
  renderPurchases();
}

function renderEditNameView() {
  w.editName.value = getUser()?.displayName || "";
}

function renderEditPasswordView() {
  w.editCurrentPw.value = "";
  w.editNewPw.value = "";
}

// Fetch and list the signed-in user's real-money entitlements. View-only on the
// site (buying lives in the in-game shop, which has the animated skin previews),
// so this is a plain text list — no sprite rendering, no game-asset coupling. A
// request id guards a slow fetch from overwriting a newer render.
async function renderPurchases() {
  const host = w.accountPurchases;
  if (!host) return;
  const reqId = ++purchasesReqId;
  host.textContent = "";
  host.appendChild(el("p", { class: "account-purchases-empty", text: "Loading…" }));

  const r = await fetchEntitlements(getToken()).catch(() => null);
  if (reqId !== purchasesReqId) return; // superseded
  host.textContent = "";

  if (r && r.status === 401) { handleExpired(); return; }
  const items = (r && r.ok && Array.isArray(r.data?.entitlements)) ? r.data.entitlements : null;
  if (items === null) {
    // When the store is switched off entirely (no payments configured) there
    // simply are no purchases — say so, matching the in-game panel's benign
    // degradation. Only a genuine transient failure gets the error message.
    const disabled = r && (r.status === 503 || r.data?.error === "payments_disabled");
    host.appendChild(el("p", { class: "account-purchases-empty",
      text: disabled ? "No purchases yet." : "Couldn't load your purchases right now." }));
    return;
  }
  if (!items.length) {
    host.appendChild(el("p", { class: "account-purchases-empty", text: "No purchases yet." }));
    return;
  }
  const list = el("ul", { class: "account-purchases-list" });
  for (const e of items) {
    const { name, when } = formatPurchase(e);
    list.appendChild(el("li", { class: "account-purchase-row" }, [
      el("span", { class: "account-purchase-name", text: name }),
      when && el("span", { class: "account-purchase-when", text: when }),
    ]));
  }
  host.appendChild(list);
}

// Pure (no DOM) so it's unit-testable: turn a raw entitlement into a friendly
// label + granted date. Entitlement shape: { sku, kind, refId, grantedAt }.
export function formatPurchase(e = {}) {
  const base = (typeof e.refId === "string" && e.refId) || (typeof e.sku === "string" && e.sku) || "Item";
  const name = base.replace(/^skin\./, "").replace(/[_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let when = "";
  if (typeof e.grantedAt === "number" && e.grantedAt > 0) {
    try { when = new Date(e.grantedAt).toLocaleDateString(); } catch { when = ""; }
  }
  return { name, when };
}

// — Handlers (mirror accountPanel.js) ————————————————————————————————————

async function onSignin() {
  const email = w.signinEmail.value.trim();
  const password = w.signinPassword.value;
  if (!email || !password) { setError(w.signinError, "Enter your email and password."); return; }
  await withBusy(w.signinBtn, async () => {
    const r = await loginAccount({ email, password });
    if (r.offline) { setError(w.signinError, OFFLINE_MSG); return; }
    if (!r.ok) { setError(w.signinError, messageFor(r.error, "Couldn't sign in.")); return; }
    finishSignIn(r.data, "Signed in.");
  });
}

async function onRegister() {
  const email = w.regEmail.value.trim();
  const displayName = w.regName.value.trim();
  const password = w.regPassword.value;
  if (!email || !password) { setError(w.regError, "Enter an email and password."); return; }
  if (password.length < 8) { setError(w.regError, "Password must be at least 8 characters."); return; }
  await withBusy(w.regBtn, async () => {
    const r = await registerAccount({ email, password, displayName: displayName || undefined });
    if (r.offline) { setError(w.regError, OFFLINE_MSG); return; }
    if (!r.ok) { setError(w.regError, messageFor(r.error, "Couldn't create the account.")); return; }
    finishSignIn(r.data, "Account created.");
  });
}

async function onForgot() {
  const email = w.forgotEmail.value.trim();
  if (!email) { setError(w.forgotError, "Enter your email."); return; }
  await withBusy(w.forgotBtn, async () => {
    const r = await forgotPassword({ email });
    if (r.offline) { setError(w.forgotError, OFFLINE_MSG); return; }
    // Always success-shaped (no account enumeration) — same message regardless.
    setInfo(w.forgotInfo, "If that email has an account, a reset link is on its way.");
  });
}

async function onReset() {
  const password = w.resetPassword.value;
  if (password.length < 8) { setError(w.resetError, "Password must be at least 8 characters."); return; }
  if (!resetToken) { setError(w.resetError, "This reset link is invalid. Request a new one."); return; }
  await withBusy(w.resetBtn, async () => {
    const r = await resetPassword({ token: resetToken, password });
    if (r.offline) { setError(w.resetError, OFFLINE_MSG); return; }
    if (!r.ok) { setError(w.resetError, messageFor(r.error, "Couldn't reset the password. The link may have expired.")); return; }
    stripResetParam();
    finishSignIn(r.data, "Password updated.");
  });
}

async function onSaveProfile() {
  const displayName = w.editName.value.trim();
  await withBusy(w.editNameSaveBtn, async () => {
    const r = await updateMe(getToken(), { displayName });
    if (r.offline) { setError(w.editNameError, OFFLINE_MSG); return; }
    if (r.status === 401) { handleExpired(); return; }
    if (!r.ok) { setError(w.editNameError, messageFor(r.error, "Couldn't save.")); return; }
    updateUser(r.data.user);
    showView("account");
    setInfo(w.accountBanner, "Display name saved.");
  });
}

async function onChangePassword() {
  const currentPassword = w.editCurrentPw.value;
  const password = w.editNewPw.value;
  if (!currentPassword || !password) { setError(w.editPasswordError, "Enter your current and new password."); return; }
  if (password.length < 8) { setError(w.editPasswordError, "New password must be at least 8 characters."); return; }
  await withBusy(w.editPasswordSaveBtn, async () => {
    const r = await updateMe(getToken(), { currentPassword, password });
    if (r.offline) { setError(w.editPasswordError, OFFLINE_MSG); return; }
    if (r.status === 401) { handleExpired(); return; }
    if (!r.ok) { setError(w.editPasswordError, messageFor(r.error, "Couldn't change the password.")); return; }
    // Server retires every token issued before the change (including ours) and
    // returns a fresh one — adopt it so this session keeps working.
    if (r.data.token) setSession(r.data.token, r.data.user);
    else updateUser(r.data.user);
    showView("account");
    setInfo(w.accountBanner, "Password changed.");
  });
}

function onSignOut() {
  signOut();
  showView("signin");
}

async function onDeleteAccount() {
  const password = w.accountDeletePw.value;
  if (!password) { setError(w.accountError, "Enter your password to confirm deletion."); return; }
  await withBusy(w.accountDeleteConfirmBtn, async () => {
    const r = await deleteAccount(getToken(), { password });
    if (r.offline) { setError(w.accountError, OFFLINE_MSG); return; }
    if (r.status === 401) { handleExpired(); return; }
    if (r.status === 403) { setError(w.accountError, "That password is incorrect."); return; }
    if (!r.ok) { setError(w.accountError, messageFor(r.error, "Couldn't delete the account.")); return; }
    signOut();
    showView("signin");
    setInfo(w.signinError, "Your account has been deleted.");
  });
}

// — Helpers ——————————————————————————————————————————————————————————————

function finishSignIn(data, bannerMsg) {
  if (!data?.token || !data?.user) return;
  setSession(data.token, data.user);
  clearInputs();
  showView("account");
  setInfo(w.accountBanner, bannerMsg);
}

function handleExpired() {
  signOut();
  showView("signin");
  setError(w.signinError, "Your session expired — please sign in again.");
}

const OFFLINE_MSG = "You appear to be offline. Try again when you're connected.";

function messageFor(code, fallback) {
  switch (code) {
    case "email_taken": return "That email is already registered.";
    case "invalid_email": return "That doesn't look like a valid email.";
    case "weak_password": return "Password must be 8–200 characters.";
    case "invalid_credentials": return "Wrong email or password.";
    case "wrong_password": return "Your current password is incorrect.";
    case "invalid_token": return "This reset link is invalid or has expired.";
    case "rate_limited": return "Too many attempts. Please wait a few minutes.";
    case "auth_unavailable": return "Accounts aren't available right now.";
    default: return fallback;
  }
}

async function withBusy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add("account-busy"); }
  try { await fn(); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove("account-busy"); } }
}

function setError(node, msg) {
  if (!node) return;
  node.textContent = msg;
  node.classList.remove("account-info");
  node.classList.add("account-error");
  node.style.display = "block";
}

function setInfo(node, msg) {
  if (!node) return;
  node.textContent = msg;
  node.classList.remove("account-error");
  node.classList.add("account-info");
  node.style.display = "block";
}

function clearErrors() {
  for (const key of ["signinError", "regError", "forgotError", "resetError",
    "accountError", "editNameError", "editPasswordError"]) {
    if (w[key]) { w[key].textContent = ""; w[key].style.display = "none"; }
  }
  for (const key of ["forgotInfo", "accountBanner"]) {
    if (w[key]) { w[key].textContent = ""; w[key].style.display = "none"; }
  }
}

function clearInputs() {
  for (const key of ["signinEmail", "signinPassword", "regEmail", "regName", "regPassword",
    "forgotEmail", "resetPassword", "editCurrentPw", "editNewPw"]) {
    if (w[key]) w[key].value = "";
  }
}

// Drop ?reset=… after a successful reset so a refresh doesn't reopen the spent
// view. Mirrors accountPanel.stripResetParam.
function stripResetParam() {
  resetToken = null;
  try {
    const url = new URL(location.href);
    url.searchParams.delete("reset");
    history.replaceState(null, "", url.toString());
  } catch { /* ignore */ }
}

// Account-page + header-chip styling, injected once. Matches the landing's
// monospace dark aesthetic (literal colors, not the game's --sb-* tokens).
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("site-account-styles")) return;
  const style = document.createElement("style");
  style.id = "site-account-styles";
  style.textContent = `
    .site-auth-link {
      display: inline-block; text-decoration: none;
      padding: 6px 14px; border-radius: 6px;
      border: 1px solid #3a3a3a; color: #ddd; background: #161616;
      font-size: 13px; letter-spacing: 0.5px;
    }
    .site-auth-link:hover { border-color: #6a7bd0; background: #1c1c1c; text-decoration: none; }

    .account-card {
      background: #131313; border: 1px solid #222; border-radius: 6px;
      padding: 24px 28px; max-width: 420px; margin: 40px auto 0;
    }
    .account-card h1 { margin: 0 0 16px; font-size: 18px; letter-spacing: 1px; color: #fff; }
    .account-hint { color: #888; font-size: 11px; margin: 14px 0 6px; }
    .account-email { color: #ddd; font-size: 13px; margin: 0 0 12px; word-break: break-all; }
    .account-error { color: #e88; font-size: 12px; margin: 8px 0 0; }
    .account-info { color: #8c8; font-size: 12px; margin: 8px 0 0; }
    .account-card input.account-input {
      display: block; width: 100%; box-sizing: border-box;
      background: #0d0d0d; color: #ddd; border: 1px solid #555; border-radius: 4px;
      padding: 8px 10px; margin: 6px 0; font-family: inherit; font-size: 13px;
    }
    .account-card button {
      background: #1d1d1d; color: #ddd; border: 1px solid #3a3a3a;
      padding: 8px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    .account-card button:hover:not(:disabled) { background: #262626; }
    .account-card button:disabled, .account-card button.account-busy { cursor: not-allowed; opacity: 0.5; }
    .account-card button.account-primary {
      display: block; width: 100%; margin: 10px 0 4px;
      background: #9ab1ff; border-color: #9ab1ff; color: #0d0d0d; font-weight: 700; text-align: center;
    }
    .account-card button.account-primary:hover:not(:disabled) { background: #b3c4ff; border-color: #b3c4ff; }
    .account-card button.account-action {
      display: flex; width: 100%; margin: 8px 0 0;
      align-items: center; justify-content: space-between; text-align: left;
    }
    .account-card button.account-action::after { content: "\\203A"; opacity: 0.6; }
    .account-card button.account-danger {
      display: block; width: 100%; margin: 18px 0 0;
      background: #2a1818; border-color: #5a2a2a; color: #e0b0b0;
    }
    .account-card button.account-danger:hover { background: #3a2020; }
    .account-purchases { margin: 4px 0 0; }
    .account-purchases-empty { color: #888; font-size: 12px; margin: 4px 0 0; }
    .account-purchases-list { list-style: none; margin: 4px 0 0; padding: 0; }
    .account-purchase-row {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 10px; padding: 5px 0; font-size: 13px; border-bottom: 1px solid #1d1d1d;
    }
    .account-purchase-name { color: #ddd; }
    .account-purchase-when { color: #777; font-size: 11px; flex: 0 0 auto; }
    .account-links { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 0; }
    .account-card button.account-link {
      background: none; border: none; padding: 0; color: #9ab1ff;
      font-size: 11px; text-align: left; cursor: pointer;
    }
    .account-card button.account-link:hover { text-decoration: underline; background: none; }
    .account-danger-label { color: #c98; margin-top: 18px; }
    .account-delete-confirm { margin-top: 8px; }
    .account-delete-confirm button { margin: 4px 6px 0 0; width: auto; display: inline-block; }
    .account-legal { color: #888; font-size: 10px; margin: 16px 0 0; }
    .account-legal a { color: #9ab1ff; text-decoration: none; }
    .account-legal a:hover { text-decoration: underline; }
    @media (max-width: 480px) {
      .account-card { margin: 20px 12px 0; padding: 24px 16px; }
    }
  `;
  document.head.appendChild(style);
}

// — Self-wiring ——————————————————————————————————————————————————————————

function boot() {
  const link = document.getElementById("account-link");
  if (link) mountAuthLink(link);
  const app = document.getElementById("account-app");
  if (app) mountAccountPage(app);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}
