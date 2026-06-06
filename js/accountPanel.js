// Account UI: a fullscreen modal with five sub-views — sign in, register,
// forgot password, reset password, and the signed-in account page. DOM-only
// (no canvas), mirrors partyPanel.js's build-once / toggle-by-display
// structure and registers a menuNav surface for keyboard + controller nav.
//
// Offline-first: this module installs with the game but makes no blocking
// network call at boot. A signed-in session is shown from cache immediately;
// a background revalidate runs once, non-blocking, and never signs the user
// out on failure. Opening the panel offline still works — actions just
// report a friendly "you're offline" message and gameplay is never gated.

import { registerMenuSurface, focusFirstIn } from "./menuNav.js";
import { showToast } from "./toast.js";
import {
  getUser, getToken, isSignedIn, setSession, updateUser, signOut,
  onAccountChange, revalidate, resolveResetToken,
} from "./accountSession.js";
import {
  registerAccount, loginAccount, updateMe, forgotPassword, resetPassword, deleteAccount,
} from "./accountApi.js";
import { el, showOnly } from "./dom.js";

let overlay = null;
let card = null;
let installed = false;
let lastFocusedView = null;
let currentView = null; // "signin" | "register" | "forgot" | "reset" | "account"
let resetToken = null;  // captured from ?reset=… for the reset view

// View subtrees, built once and toggled by display.
const views = {};
// Per-view widget refs (inputs, error <p>, etc.).
const w = {};

export function installAccountPanel() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  injectStyles();
  buildOverlay();
  document.body.appendChild(overlay);
  registerMenuSurface({ root: visibleAccountView, isOpen: isAccountPanelOpen, priority: 6 });
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (!isAccountPanelOpen()) return;
    e.preventDefault();
    // Installed before the menu's listener — stop the menu from popping the
    // pause overlay once we've closed (same trick as partyPanel).
    e.stopImmediatePropagation();
    closeAccountPanel();
  });

  // Debug / e2e hook, mirroring window.coop / window.save / __menuNav. Lets
  // tests drive the panel and read sign-in state without a build step.
  if (typeof window !== "undefined") {
    window.account = {
      open: openAccountPanel,
      close: closeAccountPanel,
      isOpen: isAccountPanelOpen,
      isSignedIn: () => isSignedIn(),
      user: () => getUser(),
    };
  }

  // Reset deep link: a password-reset email lands on /?reset=<token>. Open
  // straight to the reset view so the user can choose a new password.
  resetToken = resolveResetToken();
  if (resetToken) {
    openAccountPanel("reset");
  } else if (isSignedIn()) {
    // Best-effort, non-blocking token check. Never blocks boot or gameplay.
    setTimeout(() => { revalidate().catch(() => {}); }, 0);
  }
}

export function openAccountPanel(view) {
  if (!installed) installAccountPanel();
  if (!overlay) return;
  overlay.style.display = "flex";
  showView(view || (isSignedIn() ? "account" : "signin"));
}

export function closeAccountPanel() {
  if (overlay) overlay.style.display = "none";
  lastFocusedView = null;
}

export function isAccountPanelOpen() {
  return !!overlay && overlay.style.display === "flex";
}

function visibleAccountView() {
  return Object.values(views).find((v) => v && v.style.display !== "none") || null;
}

// — Build ——————————————————————————————————————————————————————————————

function buildOverlay() {
  views.signin = buildSigninView();
  views.register = buildRegisterView();
  views.forgot = buildForgotView();
  views.reset = buildResetView();
  views.account = buildAccountView();
  card = el("div", { class: "account-card" }, [...Object.values(views), buildCloseRow()]);
  overlay = el("div", {
    id: "account-overlay",
    style: { display: "none" },
    on: { click: (e) => { if (e.target === overlay) closeAccountPanel(); } },
  }, card);

  // Repaint the account view if sign-in state changes while it's the open
  // view (e.g. a revalidate updates the display name).
  onAccountChange(() => {
    if (isAccountPanelOpen() && currentView === "account") renderAccountView();
  });
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
    text: "An account is optional — it'll let you sync progress across devices once cloud saves land." }));
  w.regEmail = field(root, { type: "email", placeholder: "Email", autocomplete: "email" });
  w.regName = field(root, { type: "text", placeholder: "Display name (optional)", autocomplete: "nickname" });
  w.regPassword = field(root, { type: "password", placeholder: "Password (min 8 characters)", autocomplete: "new-password", onEnter: onRegister });
  w.regError = errorEl(root);
  w.regBtn = primaryButton(root, "Create account", onRegister);
  linkRow(root, [{ label: "Already have an account? Sign in", view: "signin" }]);
  root.appendChild(buildLegalFooter("By creating an account you agree to the"));
  return root;
}

// Small print linking the legal pages (also satisfies store/GDPR
// requirements that the policy be reachable at sign-up).
function buildLegalFooter(lead) {
  return el("p", {
    class: "account-legal",
    html: `${lead} ` +
      `<a href="terms.html" target="_blank" rel="noopener">Terms</a> and ` +
      `<a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.`,
  });
}

function buildForgotView() {
  const root = viewRoot("forgot", "Reset password");
  root.appendChild(el("p", { class: "account-hint",
    text: "Enter your email and we'll send a link to choose a new password." }));
  w.forgotEmail = field(root, { type: "email", placeholder: "Email", autocomplete: "email", onEnter: onForgot });
  w.forgotError = errorEl(root);
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
  w.accountEmail = el("p", { class: "account-email" });
  root.appendChild(w.accountEmail);

  root.appendChild(el("p", { class: "account-hint", text: "Display name" }));
  w.accountName = field(root, { type: "text", placeholder: "Display name", autocomplete: "nickname" });
  w.accountError = errorEl(root);
  w.accountSaveBtn = primaryButton(root, "Save display name", onSaveProfile);

  root.appendChild(el("p", { class: "account-hint", text: "Change password" }));
  w.accountCurrentPw = field(root, { type: "password", placeholder: "Current password", autocomplete: "current-password" });
  w.accountNewPw = field(root, { type: "password", placeholder: "New password (min 8 characters)", autocomplete: "new-password", onEnter: onChangePassword });
  w.accountChangePwBtn = primaryButton(root, "Change password", onChangePassword);

  root.appendChild(el("button", { class: "account-danger", text: "Sign out", on: { click: onSignOut } }));

  // Danger zone: delete account. Hidden behind a reveal + password confirm so
  // it can't be hit by accident (or by a stolen token).
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
    class: "account-danger", text: "Permanently delete",
    on: { click: onDeleteAccount },
  });
  w.accountDeleteConfirm = el("div", { class: "account-delete-confirm", style: { display: "none" } }, [
    el("p", { class: "account-error", style: { display: "block" },
      text: "This permanently deletes your account and cloud save. This cannot be undone." }),
    w.accountDeletePw,
    w.accountDeleteConfirmBtn,
    el("button", { text: "Cancel", on: { click: () => showDeleteConfirm(false) } }),
  ]);
  root.appendChild(w.accountDeleteConfirm);

  root.appendChild(buildLegalFooter("See our"));
  return root;
}

function showDeleteConfirm(on) {
  if (!w.accountDeleteConfirm) return;
  w.accountDeleteConfirm.style.display = on ? "block" : "none";
  w.accountDeleteBtn.style.display = on ? "none" : "block";
  if (!on && w.accountDeletePw) w.accountDeletePw.value = "";
  if (on && isAccountPanelOpen()) focusFirstIn(w.accountDeleteConfirm);
}

function buildCloseRow() {
  return el("div", { class: "account-close-row" }, [
    el("button", { text: "Close", on: { click: closeAccountPanel } }),
  ]);
}

// — View switching ——————————————————————————————————————————————————————

function showView(name) {
  currentView = name;
  showOnly(views, name);
  clearErrors();
  if (name === "account") renderAccountView();
  const v = views[name];
  if (v && isAccountPanelOpen() && v !== lastFocusedView) {
    lastFocusedView = v;
    focusFirstIn(v);
  }
}

function renderAccountView() {
  const user = getUser();
  if (!user) { showView("signin"); return; }
  w.accountEmail.textContent = user.email;
  w.accountName.value = user.displayName || "";
  showDeleteConfirm(false);
}

// — Handlers ————————————————————————————————————————————————————————————

async function onSignin() {
  const email = w.signinEmail.value.trim();
  const password = w.signinPassword.value;
  if (!email || !password) { setError(w.signinError, "Enter your email and password."); return; }
  await withBusy(w.signinBtn, async () => {
    const r = await loginAccount({ email, password });
    if (r.offline) { setError(w.signinError, OFFLINE_MSG); return; }
    if (!r.ok) { setError(w.signinError, messageFor(r.error, "Couldn't sign in.")); return; }
    finishSignIn(r.data, "Signed in");
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
    finishSignIn(r.data, "Account created");
  });
}

async function onForgot() {
  const email = w.forgotEmail.value.trim();
  if (!email) { setError(w.forgotError, "Enter your email."); return; }
  await withBusy(w.forgotBtn, async () => {
    const r = await forgotPassword({ email });
    if (r.offline) { setError(w.forgotError, OFFLINE_MSG); return; }
    // Always success-shaped (no enumeration). Show the same message regardless.
    showToast("If that email has an account, a reset link is on its way.", "longHint");
    showView("signin");
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
    finishSignIn(r.data, "Password updated");
  });
}

async function onSaveProfile() {
  const displayName = w.accountName.value.trim();
  await withBusy(w.accountSaveBtn, async () => {
    const r = await updateMe(getTokenOrNull(), { displayName });
    if (r.offline) { setError(w.accountError, OFFLINE_MSG); return; }
    if (r.status === 401) { handleExpired(); return; }
    if (!r.ok) { setError(w.accountError, messageFor(r.error, "Couldn't save.")); return; }
    updateUser(r.data.user);
    showToast("Display name saved", "hint");
  });
}

async function onChangePassword() {
  const currentPassword = w.accountCurrentPw.value;
  const password = w.accountNewPw.value;
  if (!currentPassword || !password) { setError(w.accountError, "Enter your current and new password."); return; }
  if (password.length < 8) { setError(w.accountError, "New password must be at least 8 characters."); return; }
  await withBusy(w.accountChangePwBtn, async () => {
    const r = await updateMe(getTokenOrNull(), { currentPassword, password });
    if (r.offline) { setError(w.accountError, OFFLINE_MSG); return; }
    if (r.status === 401) { handleExpired(); return; }
    if (!r.ok) { setError(w.accountError, messageFor(r.error, "Couldn't change the password.")); return; }
    // The server retires every token issued before the change (including the
    // one we just used) and hands back a fresh one — adopt it so this session
    // keeps working. Other devices' tokens are now invalid, as intended.
    if (r.data.token) setSession(r.data.token, r.data.user);
    else updateUser(r.data.user);
    w.accountCurrentPw.value = "";
    w.accountNewPw.value = "";
    showToast("Password changed", "hint");
  });
}

function onSignOut() {
  signOut();
  showToast("Signed out", "hint");
  showView("signin");
}

async function onDeleteAccount() {
  const password = w.accountDeletePw.value;
  if (!password) { setError(w.accountError, "Enter your password to confirm deletion."); return; }
  await withBusy(w.accountDeleteConfirmBtn, async () => {
    const r = await deleteAccount(getTokenOrNull(), { password });
    if (r.offline) { setError(w.accountError, OFFLINE_MSG); return; }
    if (r.status === 401) { handleExpired(); return; }
    if (r.status === 403) { setError(w.accountError, "That password is incorrect."); return; }
    if (!r.ok) { setError(w.accountError, messageFor(r.error, "Couldn't delete the account.")); return; }
    // Account (and its cloud save) are gone. Sign out locally; local game
    // progress on this device is left intact so play continues offline.
    signOut();
    showToast("Your account has been deleted", "longHint");
    closeAccountPanel();
  });
}

// — Helpers ————————————————————————————————————————————————————————————

function finishSignIn(data, toastMsg) {
  if (!data?.token || !data?.user) return;
  setSession(data.token, data.user);
  clearInputs();
  showToast(toastMsg, "hint");
  closeAccountPanel();
}

function handleExpired() {
  signOut();
  showToast("Your session expired — please sign in again.", "longHint");
  showView("signin");
}

function getTokenOrNull() {
  // Re-read each call so a token refreshed by revalidate is always used.
  return getToken();
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

function setError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}

function clearErrors() {
  for (const key of ["signinError", "regError", "forgotError", "resetError", "accountError"]) {
    if (w[key]) { w[key].textContent = ""; w[key].style.display = "none"; }
  }
}

function clearInputs() {
  for (const key of ["signinEmail", "signinPassword", "regEmail", "regName", "regPassword",
    "forgotEmail", "resetPassword", "accountCurrentPw", "accountNewPw"]) {
    if (w[key]) w[key].value = "";
  }
}

// Drop ?reset=… from the URL after a successful reset so a refresh doesn't
// reopen the (now-spent) reset view.
function stripResetParam() {
  resetToken = null;
  try {
    const url = new URL(location.href);
    url.searchParams.delete("reset");
    history.replaceState(null, "", url.toString());
  } catch { /* ignore */ }
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("account-styles")) return;
  const style = document.createElement("style");
  style.id = "account-styles";
  style.textContent = `
    #account-overlay {
      position: fixed; inset: 0;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(2px);
      z-index: 22; color: var(--sb-text); font-family: var(--sb-font);
    }
    .account-card {
      background: var(--sb-card-bg);
      border: var(--sb-card-border);
      border-radius: var(--sb-card-radius);
      padding: 24px 28px; min-width: 320px; max-width: 420px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .account-card h1 { margin: 0 0 16px; font-size: 18px; letter-spacing: 1px; }
    .account-hint { color: var(--sb-text-dim); font-size: 11px; margin: 14px 0 6px; }
    .account-email { color: var(--sb-text); font-size: 13px; margin: 0 0 12px; word-break: break-all; }
    .account-error { color: #e88; font-size: 12px; margin: 8px 0 0; }
    .account-card input.account-input {
      display: block; width: 100%; box-sizing: border-box;
      background: #111; color: var(--sb-text);
      border: 1px solid #555; border-radius: var(--sb-surface-radius);
      padding: 8px 10px; margin: 6px 0; font-family: inherit; font-size: 13px;
    }
    .account-card button {
      background: #2a2a2a; color: var(--sb-text); border: 1px solid #444;
      padding: 8px 12px; border-radius: var(--sb-surface-radius); cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    .account-card button:hover:not(:disabled) { background: #353535; }
    .account-card button:disabled, .account-card button.account-busy { cursor: not-allowed; opacity: 0.5; }
    .account-card button.account-primary {
      display: block; width: 100%; margin: 10px 0 4px;
      background: #2a3a55; border-color: #4a5a88; color: #fff; text-align: center;
    }
    .account-card button.account-primary:hover:not(:disabled) { background: #34466a; }
    .account-card button.account-danger {
      display: block; width: 100%; margin: 18px 0 0;
      background: var(--sb-accent-danger-bg); border-color: var(--sb-accent-danger-border);
    }
    .account-card button.account-danger:hover { background: #4a2828; }
    .account-links { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 0; }
    .account-card button.account-link {
      background: none; border: none; padding: 0; color: #9ab1ff;
      font-size: 11px; text-align: left; cursor: pointer;
    }
    .account-card button.account-link:hover { text-decoration: underline; background: none; }
    .account-danger-label { color: #c98; margin-top: 18px; }
    .account-delete-confirm { margin-top: 8px; }
    .account-delete-confirm button { margin: 4px 6px 0 0; }
    .account-legal { color: var(--sb-text-dim); font-size: 10px; margin: 16px 0 0; }
    .account-legal a { color: #9ab1ff; text-decoration: none; }
    .account-legal a:hover { text-decoration: underline; }
    .account-close-row { display: flex; justify-content: flex-end; margin-top: 18px; }
    /* On narrow screens the card fills the viewport, leaving a 12px lateral
       margin; box-sizing folds the padding into that width so the content
       also gets 12px of horizontal breathing room. */
    @media (max-width: 480px) {
      .account-card {
        box-sizing: border-box;
        min-width: 0;
        width: calc(100vw - 24px);
        max-width: calc(100vw - 24px);
        padding: 24px 12px;
      }
    }
  `;
  document.head.appendChild(style);
}

// Test seam — reset module-level singletons between unit tests.
export function _resetAccountPanelForTesting() {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
  card = null;
  installed = false;
  lastFocusedView = null;
  currentView = null;
  resetToken = null;
  for (const k of Object.keys(views)) delete views[k];
  for (const k of Object.keys(w)) delete w[k];
}
