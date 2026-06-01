// Client-side account session: the cached {token, user} in localStorage,
// plus a subscribe/notify mechanism so the menu + panel react to sign-in /
// sign-out. Offline-first: nothing here touches the network at module load,
// and a failed background revalidate NEVER signs the user out (only an
// explicit 401 from the server does).
//
// The cloud-save milestone hooks onAccountChange to sync the
// sneakbit.kv.v1.* progress blob on sign-in — see the spec's forward design.

import { fetchMe } from "./accountApi.js";

const KEY = "sneakbit.account.v1";

// `undefined` = not yet loaded from storage; `null` = loaded, signed out.
let session = undefined;
const subscribers = new Set();

function load() {
  if (session !== undefined) return session;
  session = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.token && parsed.user) session = parsed;
    }
  } catch { /* no/blocked localStorage — stay signed out */ }
  return session;
}

function persist() {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

function notify() {
  const user = getUser();
  for (const fn of [...subscribers]) {
    try { fn(user); } catch (e) { console.error("[account] onAccountChange handler", e); }
  }
}

export function getToken() { return load()?.token || null; }
export function getUser() { return load()?.user || null; }
export function isSignedIn() { return !!getToken(); }

export function setSession(token, user) {
  session = { token, user };
  persist();
  notify();
}

export function updateUser(user) {
  if (!load()) return;
  session = { token: session.token, user };
  persist();
  notify();
}

export function signOut() {
  if (!load()) return;
  session = null;
  persist();
  notify();
}

// Subscribe to sign-in/out/profile changes. Fires with the current user (or
// null). Returns an unsubscribe fn.
export function onAccountChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// Best-effort token check against /auth/me. Offline or a 5xx keeps the
// cached session untouched; only a 401 (token expired/invalid) signs out.
// Safe to call fire-and-forget — it swallows everything.
export async function revalidate() {
  const token = getToken();
  if (!token) return;
  let r;
  try { r = await fetchMe(token); } catch { return; }
  if (r.offline) return;
  if (r.status === 401) { signOut(); return; }
  if (r.ok && r.data?.user) updateUser(r.data.user);
}

// Parse a `?reset=<token>` deep link (reset emails point here). Mirrors
// onlineMode.resolveMode's URLSearchParams approach.
export function resolveResetToken(search = typeof location !== "undefined" ? location.search : "") {
  try {
    const token = new URLSearchParams(search || "").get("reset");
    if (token && token.length >= 16) return token;
  } catch { /* ignore */ }
  return null;
}

// Test seam — reset module state without touching localStorage.
export function _resetAccountSessionForTesting() {
  session = undefined;
  subscribers.clear();
}
