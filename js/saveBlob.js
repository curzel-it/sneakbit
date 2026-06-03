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

import { STARTING_ZONE_ID } from "./constants.js";

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

// True when local progress is more than a fresh-boot default — i.e. the player
// has actually played (a skill unlock, an item, a dialogue answer, a visited
// zone, …) rather than just opened the page. This is the content-aware signal
// cloudSave needs to tell a genuine first-sign-in conflict (real offline
// progress vs a different account save, which must NOT be silently clobbered)
// apart from the common "fresh device adopts the account" case. It cannot be a
// timestamp/`hasLocalProgress` check: a fresh boot writes a starting save, so
// those are already "recent" and "present" on a brand-new device.
//
// Detection is a conservative ALLOWLIST of progress markers — kv keys that only
// appear through genuine play. A fresh boot writes build_number, the starting
// zone + spawn, and a did_visit for the starting zone; none of those match. The
// asymmetry is deliberate: a missed category just falls back to the historical
// safe default (adopt the account), whereas a boot key mistaken for progress
// would pop a spurious conflict prompt on every brand-new device. So we only
// ever say "meaningful" for things we're sure indicate real advancement.
export function hasMeaningfulProgress() {
  const kv = readKv();
  // Advanced past the starting zone.
  const zone = kv.latest_zone;
  if (zone != null && Number(zone) !== STARTING_ZONE_ID) return true;
  for (const [k, v] of Object.entries(kv)) {
    if (k.startsWith("skill.")) return true;            // unlocked a skill
    if (k.startsWith("dialogue.answer.")) return true;  // answered a dialogue
    if (k.startsWith("item_collected.")) return true;   // picked up a world item
    if (/^player\.\d+\.equipped\./.test(k)) return true; // equipped a weapon
    // Holds inventory items (amount > 0; a 0/cleared slot is not progress).
    if (/^player\.\d+\.inventory\.amount\./.test(k) && Number(v) > 0) return true;
    // Visited a zone other than the starting one.
    if (k.startsWith("did_visit.") && Number(k.slice("did_visit.".length)) !== STARTING_ZONE_ID) return true;
  }
  return false;
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
  const next = (kv && typeof kv === "object") ? kv : {};
  // Snapshot the existing namespace BEFORE touching it. A pulled save is
  // authoritative for the whole kv namespace, but the old code deleted every
  // key first and only then wrote the new ones — a mid-write quota/private-mode
  // throw left the store wiped or half-written, losing real progress. Instead:
  // write the new set first, prune stale keys only after every write lands, and
  // roll back to this snapshot if anything throws.
  const prev = readKv();
  const written = [];
  try {
    for (const [k, v] of Object.entries(next)) {
      if (typeof v !== "string") continue;
      localStorage.setItem(KV_PREFIX + k, v);
      written.push(k);
    }
    // Every new key landed — now drop the stale keys absent from the pull.
    for (const k of Object.keys(prev)) {
      if (!(k in next)) localStorage.removeItem(KV_PREFIX + k);
    }
  } catch {
    // Best-effort rollback: drop the keys we added that weren't there before
    // (frees the space the failed write consumed), then restore the snapshot.
    try {
      for (const k of written) {
        if (!(k in prev)) localStorage.removeItem(KV_PREFIX + k);
      }
      for (const [k, v] of Object.entries(prev)) localStorage.setItem(KV_PREFIX + k, v);
    } catch { /* ignore — nothing more we can safely do */ }
  }
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
