// Online-mode bookkeeping: which role (offline / host / guest) this tab
// is running as, the persistent UUIDv4 identity, and the per-mode storage
// namespace. The mode is fixed for the lifetime of the page — toggling
// roles is a full reload.
//
// URL contract (matches host-authoritative-server.md):
//   no params      → offline (default)
//   ?host=1        → host
//   ?join=CODE     → guest
//   ?server=ws://... → optional override of the relay URL

const ONLINE_UUID_KEY = "sneakbit.online.uuid";

let cachedMode = null;
let cachedCode = null;
let cachedUuid = null;

export function resolveMode(search) {
  const p = new URLSearchParams(search || "");
  if (p.has("host") && p.get("host") !== "0") return { mode: "host", code: null };
  if (p.has("join")) {
    const raw = (p.get("join") || "").trim().toUpperCase();
    return { mode: "guest", code: raw || null };
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

// Test-only seams.
export function _setOnlineModeForTesting({ mode = "offline", code = null, uuid = null } = {}) {
  cachedMode = mode;
  cachedCode = code;
  if (uuid !== null) cachedUuid = uuid;
}

export function _resetOnlineModeForTesting() {
  cachedMode = null;
  cachedCode = null;
  cachedUuid = null;
}
