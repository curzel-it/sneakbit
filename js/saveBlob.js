// Serialize / apply the account-scoped progress blob synced by cloudSave.js.
// The blob is the single source of truth for what travels between devices:
//
//   kv       — every sneakbit.kv.v1.* key (zone + spawn position, dialogue
//              answers, skill unlocks, equipment, per-player inventory
//              amounts, after-dialogue tracking — the whole game progress)
//   bindings — key + gamepad rebinds (per-account, per the scope decision)
//   language — settings.language ONLY; volume/FPS/touch stay per-device
//
// Deliberately excluded: settings volumes/flags, online.uuid, account token,
// biome sprite cache, creative flag, the cloudSave meta, and the devtools-only
// skills.override key.
//
// applyBlob writes straight to localStorage (NOT through storage.js) so it
// doesn't trip cloudSave's change listener into a feedback loop; the caller
// reloads the page afterward so every module rehydrates cleanly.

const KV_PREFIX = "sneakbit.kv.v1.";
const SETTINGS_KEY = "sneakbit.settings.v1";
const BINDING_KEYS = [
  "sneakbit.keyBindings.v1",
  "sneakbit.keyBindings.v2",
  "sneakbit.gamepadBindings.v1",
];
const BINDING_SHORT = (key) => key.slice("sneakbit.".length);

export function serializeBlob() {
  return {
    v: 1,
    kv: readKv(),
    bindings: readBindings(),
    language: readLanguage(),
  };
}

export function applyBlob(blob) {
  if (!blob || typeof blob !== "object") return;
  writeKv(blob.kv);
  writeBindings(blob.bindings);
  if (typeof blob.language === "string") mergeLanguage(blob.language);
}

// True when this device has any local game progress (a saved zone). Drives
// cloudSave's "empty local → just pull" branch.
export function hasLocalProgress() {
  return ls(KV_PREFIX + "latest_zone") != null;
}

// — kv ————————————————————————————————————————————————————————————————————

function readKv() {
  const kv = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KV_PREFIX)) kv[k.slice(KV_PREFIX.length)] = localStorage.getItem(k);
    }
  } catch { /* ignore */ }
  return kv;
}

function writeKv(kv) {
  try {
    // Replace wholesale: drop existing kv keys, then write the blob's. A
    // pulled save is authoritative for the entire progress namespace.
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KV_PREFIX)) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
    if (kv && typeof kv === "object") {
      for (const [k, v] of Object.entries(kv)) {
        if (typeof v === "string") localStorage.setItem(KV_PREFIX + k, v);
      }
    }
  } catch { /* ignore */ }
}

// — bindings ——————————————————————————————————————————————————————————————

function readBindings() {
  const out = {};
  for (const key of BINDING_KEYS) {
    const v = ls(key);
    if (v != null) out[BINDING_SHORT(key)] = v;
  }
  return out;
}

function writeBindings(bindings) {
  if (!bindings || typeof bindings !== "object") return;
  for (const key of BINDING_KEYS) {
    const short = BINDING_SHORT(key);
    if (short in bindings) setLs(key, bindings[short]);
  }
}

// — language (field-level merge into settings) ————————————————————————————

function readLanguage() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return typeof s?.language === "string" ? s.language : null;
  } catch { return null; }
}

// Set ONLY the language field, preserving local volume/FPS/touch settings.
function mergeLanguage(language) {
  try {
    let s = {};
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) { try { s = JSON.parse(raw) || {}; } catch { s = {}; } }
    s.language = language;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

// — localStorage helpers ——————————————————————————————————————————————————

function ls(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function setLs(key, val) {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch { /* ignore */ }
}
