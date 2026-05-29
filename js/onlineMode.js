// Online-mode bookkeeping: which role this tab is *currently* running as,
// the URL the tab booted with, the persistent UUIDv4 identity, and the
// per-mode storage namespace.
//
// Two distinct notions of "role" live here:
//   - getMode() / getJoinCode() — read once from the URL at boot. Used
//     by deep-link entry-point logic (?host=1, ?join=CODE). Does NOT
//     update at runtime.
//   - getRuntimeRole() — the live role the tab is currently in. Starts
//     null; switchRole() drives transitions between offline / host /
//     guest in-place (no page reload).
//
// URL contract (matches docs/online-coop.md):
//   no params      → offline (default)
//   ?host=1        → host
//   ?join=CODE     → guest
//   ?server=ws://... → optional override of the relay URL

const ONLINE_UUID_KEY = "sneakbit.online.uuid";

// Invite codes are minted server-side as 5 chars of [A-Z0-9]. Anything
// else can't be a real code, so it's either a typo or someone fuzzing —
// we reject before any network round-trip. Exported so the UI's join
// form, the URL parser, and the handshake dispatcher all share one
// canonical pattern.
export const JOIN_CODE_PATTERN = /^[A-Z0-9]{5}$/;

export function isValidJoinCode(code) {
  return typeof code === "string" && JOIN_CODE_PATTERN.test(code);
}

// Boot-URL cache. These three values are seeded from `location.search`
// on first read and NEVER refreshed by switchRole() or any other
// runtime transition — getMode() / getJoinCode() are deep-link
// metadata, not live state. If we ever add a "Leave to offline"
// runtime path that needs the *current* mode (rather than the URL the
// tab was opened with), switch the callsite to getRuntimeRole() — the
// runtime-role machinery below is the writable counterpart.
//
// Only _resetOnlineModeForTesting / _setOnlineModeForTesting can
// invalidate these; production code treats them as boot-time
// constants.
let cachedMode = null;
let cachedCode = null;
let cachedUuid = null;

// Runtime role state. Distinct from cachedMode, which only reflects the
// boot URL. switchRole() mutates this; partyPanel + status chip + main.js
// tick gate subscribe to changes.
let runtimeRole = null;
const roleSubscribers = new Set();

export function resolveMode(search) {
  const p = new URLSearchParams(search || "");
  if (p.has("host") && p.get("host") !== "0") return { mode: "host", code: null };
  if (p.has("join")) {
    const raw = (p.get("join") || "").trim().toUpperCase();
    // Treat a malformed `?join=` like an empty one — still enter guest
    // mode (so the panel can prompt for a valid code) but don't carry
    // the garbage through to the relay.
    const code = isValidJoinCode(raw) ? raw : null;
    return { mode: "guest", code };
  }
  return { mode: "offline", code: null };
}

function locationSearch() {
  if (typeof location === "undefined" || location == null) return "";
  return location.search || "";
}

function ensureCached() {
  if (cachedMode != null) return;
  const r = resolveMode(locationSearch());
  cachedMode = r.mode;
  cachedCode = r.code;
}

// Perma-cached after first call. See cachedMode block above — callers
// that want the *current* role must use getRuntimeRole(), not this.
export function getMode() { ensureCached(); return cachedMode; }
export function getJoinCode() { ensureCached(); return cachedCode; }

export function getStorageNamespace() {
  const m = getMode();
  if (m === "host") return "host";
  if (m === "guest") return "guest";
  return "";
}

function uuidv4() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getOnlineUuid() {
  if (cachedUuid) return cachedUuid;
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(ONLINE_UUID_KEY);
      if (stored && stored.length >= 8) { cachedUuid = stored; return cachedUuid; }
    }
  } catch { /* ignore */ }
  cachedUuid = uuidv4();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ONLINE_UUID_KEY, cachedUuid);
    }
  } catch { /* ignore */ }
  return cachedUuid;
}

export function getRuntimeRole() { return runtimeRole; }

// switchRole.js is the canonical writer here, but the function itself is
// exported so tests and the boot path can seed it directly. Subscribers
// fire synchronously in registration order; a thrown handler is logged
// and does not block others.
export function setRuntimeRole(role) {
  if (runtimeRole === role) return;
  runtimeRole = role;
  for (const fn of [...roleSubscribers]) {
    try { fn(role); }
    catch (e) { console.error("onRoleChange handler", e); }
  }
}

export function onRoleChange(fn) {
  roleSubscribers.add(fn);
  return () => roleSubscribers.delete(fn);
}

// Test-only seams.
export function _setOnlineModeForTesting({ mode = "offline", code = null, uuid = null } = {}) {
  cachedMode = mode;
  cachedCode = code;
  if (uuid !== null) cachedUuid = uuid;
  // Tests that pre-date the URL/runtime split set up "host" / "guest"
  // via this seam and then call install-time gates that read the runtime
  // role. Mirror the mode here so those callers keep working without
  // having to set runtime role explicitly.
  runtimeRole = mode;
}

export function _resetOnlineModeForTesting() {
  cachedMode = null;
  cachedCode = null;
  cachedUuid = null;
  runtimeRole = null;
  roleSubscribers.clear();
}
