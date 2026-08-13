// Import a save from the pre-rewrite (Rust core) builds — Steam desktop,
// iOS, Android.
//
// Those builds persist a single flat JSON object of `{ "key": u32 }` to
// `save.json` (game_core/src/features/storage.rs). That is the same shape as
// this port's kv namespace, so an import is mostly a straight copy; only a
// handful of keys were renamed on the way over. Everything else — dialogue
// answers, collected items, npc interactions, lock overrides, pressure
// plates, per-player inventory amounts — already matches key for key.
//
// Pure: translateLegacySave takes the parsed JSON and returns what to write,
// so the mapping is unit-testable without a DOM. importLegacySave applies it.
//
// Where the old builds keep save.json:
//   Steam/desktop  <install dir>/data/save.json — beside the executable, NOT
//                  in AppData / Application Support (game/src/features/paths.rs)
//   iOS            <container>/Documents/save.json
//   Android        <filesDir>/save.json (internal storage)
//
// Two ways in. On a native shell the boot imports it automatically, once, from
// whatever the shell found on disk (importLegacyFromNative). Everywhere else —
// and as a manual escape hatch — the pause menu opens a file picker
// (pickAndImportLegacySave).

import { setValue, snapshotStorage, restoreStorage } from "./storage.js";
import { showMessage } from "./message.js";
import { showConfirm } from "./confirmDialog.js";
import { hasLocalProgress } from "./saveBlob.js";
import { getNativeState } from "./nativeBridge.js";

// Keys renamed between the Rust core and this port.
const RENAMES = {
  // v3 of the migration ladder renamed the "world" terminology to "zone".
  latest_world: "latest_zone",
};

// Prefix renames: `world.visited.<id>` (Rust StorageKey::did_visit) became
// `did_visit.<id>` (fastTravel.js).
const PREFIX_RENAMES = [
  ["world.visited.", "did_visit."],
];

// `player.<p>.currently_equipped_{ranged,melee}_weapon` became
// `player.<p>.equipped.{ranged,melee}` (equipment.js).
const EQUIPPED_RE = /^player\.(\d+)\.currently_equipped_(ranged|melee)_weapon$/;

// Never imported. These are device-local or belong to the old engine's own
// bookkeeping, and carrying them over would either do nothing or actively
// mislead this build.
//   build_number     — the Rust migration ladder's version, not ours. Importing
//                      it would mark our save as already-migrated and skip the
//                      ladder that does the latest_world → latest_zone work.
//   previous_world   — transient travel bookkeeping the port doesn't keep.
//   always           — a *virtual* key in the Rust core (get_value_for_global_key
//                      answers 1 without ever storing it), but the old iOS build
//                      seeded the file with `{"always": 1}` on first run, so real
//                      save.jsons out there do contain it.
//   is_mobile / fullscreen / language / desktop_only.* — per-device settings,
//                      owned by settings.js on this build. The audio and
//                      language ones are carried across separately, as settings
//                      rather than progress — see legacySettingsPatch.
const DROPPED = new Set([
  "build_number", "previous_world", "always", "is_mobile", "fullscreen", "language",
]);
const DROPPED_PREFIXES = ["desktop_only."];

function translateKey(key) {
  if (DROPPED.has(key)) return null;
  for (const p of DROPPED_PREFIXES) if (key.startsWith(p)) return null;
  if (key in RENAMES) return RENAMES[key];
  const eq = EQUIPPED_RE.exec(key);
  if (eq) return `player.${eq[1]}.equipped.${eq[2]}`;
  for (const [from, to] of PREFIX_RENAMES) {
    if (key.startsWith(from)) return to + key.slice(from.length);
  }
  return key;
}

// Turn a parsed legacy save.json into the kv entries this build wants.
// Returns { kv, imported, skipped, invalid }:
//   kv       — { ourKey: intValue } ready to write
//   imported — how many source keys made it through
//   skipped  — device-local / engine-private keys deliberately dropped
//   invalid  — entries whose value wasn't a finite number
// Throws on input that isn't a flat JSON object — that's a wrong-file error
// worth surfacing to the player, not something to silently import as empty.
export function translateLegacySave(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("not a SneakBit save: expected a JSON object of key/value pairs");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new Error("that save file is empty");

  const kv = {};
  let imported = 0, skipped = 0, invalid = 0;
  for (const [key, value] of entries) {
    const target = translateKey(key);
    if (target === null) { skipped++; continue; }
    // The old engine stores u32, so serde gives numbers; numeric strings are
    // accepted for hand-edited files. null/booleans/objects are NOT — Number()
    // would happily turn `null` into a very real 0 and write it as progress.
    const numeric = typeof value === "number"
      || (typeof value === "string" && value.trim() !== "");
    const n = numeric ? Number(value) : NaN;
    if (!Number.isFinite(n)) { invalid++; continue; }
    kv[target] = n | 0;
    imported++;
  }
  if (imported === 0) {
    throw new Error("that file has no importable progress — is it a SneakBit save?");
  }
  return { kv, imported, skipped, invalid };
}

// True when the translated save actually carries progress worth importing —
// a zone the player reached, or any of the usual advancement markers. Guards
// against replacing a real save with a file that parses but says nothing.
export function legacySaveHasProgress(kv) {
  if (!kv) return false;
  if (kv.latest_zone != null) return true;
  return Object.keys(kv).some((k) =>
    k.startsWith("dialogue.answer.") || k.startsWith("item_collected.") ||
    k.startsWith("did_visit.") || k.startsWith("skill.") ||
    /^player\.\d+\.inventory\.amount\./.test(k));
}

// Apply a translated save to the live kv store. The legacy save REPLACES the
// current progress (it's an import, not a merge — merging two independent
// playthroughs would produce a state neither save ever had), but settings,
// bindings and account/identity keys are untouched because they live outside
// the kv namespace.
//
// Writes go through setValue so localStorage and the in-memory cache stay in
// lockstep and cloudSave's change listener fires. A write failure mid-way
// rolls the whole namespace back to the snapshot taken first, so a failed
// import can't leave a half-replaced save.
export function applyLegacySave(kv) {
  const before = snapshotStorage();
  const wrote = [];
  try {
    // Clear the old progress first so a key the legacy save doesn't have
    // (a dialogue answered only in this build) can't survive the import.
    for (const k of Object.keys(before)) {
      if (!(k in kv)) {
        if (!setValue(k, null)) throw new Error(`failed to clear ${k}`);
      }
    }
    for (const [k, v] of Object.entries(kv)) {
      if (!setValue(k, v)) throw new Error(`failed to write ${k}`);
      wrote.push(k);
    }
  } catch (e) {
    restoreStorage(before);
    throw e;
  }
  return wrote.length;
}

// Read → translate → apply, from the raw file text. Returns the stats from
// translateLegacySave. Throws with a player-readable message on bad input.
export function importLegacySave(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("that file isn't valid JSON"); }
  const result = translateLegacySave(parsed);
  if (!legacySaveHasProgress(result.kv)) {
    throw new Error("that save has no progress in it");
  }
  applyLegacySave(result.kv);
  return result;
}

// — Automatic import on the native shells ——————————————————————————————————
// Steam, iOS and Android ship this build as an *update* to the Rust game, so
// the old save.json is already sitting in the same install dir / container.
// The shell reads it and hands it over at boot (js/nativeBridge.js); nobody
// has to find a file.

// Device-local, one-shot. Deliberately outside the `sneakbit.kv.v1.` namespace:
// applyLegacySave prunes every kv key absent from the import, and cloudSave
// syncs that namespace between devices — a marker in there would be wiped by
// the very import it guards, then travel to devices it says nothing about.
const IMPORT_MARKER_KEY = "sneakbit.legacyImport.v1";
const SETTINGS_KEY = "sneakbit.settings.v1";

// Old `language` key: 0 = follow the system, 1 = English, 2 = Italian.
const LEGACY_LANGUAGES = ["auto", "en", "it"];

// The old audio toggles. Desktop kept them in save.json, inverted (1 = off).
const LEGACY_SFX_DISABLED = "desktop_only.game_settings.sound_effects_disabled";
const LEGACY_MUSIC_DISABLED = "desktop_only.game_settings.music_disabled";

function alreadyImported() {
  try { return localStorage.getItem(IMPORT_MARKER_KEY) != null; } catch { return false; }
}

// Exported because "New game" wipes localStorage wholesale, marker included —
// without re-stamping it, the next boot would find no marker and no local save
// and hand the player back the very progress they just deleted.
export function markLegacyImportDone() {
  try { localStorage.setItem(IMPORT_MARKER_KEY, "1"); } catch { /* ignore */ }
}

// Pure. Given whether this build already holds a save and whether the legacy
// file carries progress, decide what the boot should do.
//
// "skip" means more than "do nothing now": the caller stamps the marker, so we
// never look again. That is what stops a later "New game" — which clears
// latest_zone and would otherwise read as "no local save" — from resurrecting
// the imported progress on the next boot.
export function legacyImportDecision({ hasLocalSave, legacyHasProgress }) {
  if (hasLocalSave) return "skip";
  if (!legacyHasProgress) return "skip";
  return "import";
}

// Map the old build's settings onto this one's. Returns a patch for
// sneakbit.settings.v1; `audio` is the mobile shells' native prefs
// (UserDefaults / SharedPreferences), null on desktop where the toggles live
// in save.json instead.
export function legacySettingsPatch(save, audio) {
  const raw = (save && typeof save === "object") ? save : {};
  const patch = {};

  const lang = Number(raw.language);
  if (Number.isFinite(lang) && LEGACY_LANGUAGES[lang]) patch.language = LEGACY_LANGUAGES[lang];

  // Absent means enabled — the old build defaulted both to on and only wrote a
  // key once the player toggled it off. There is no *level* to port: the old
  // build had toggles, not sliders, so an enabled channel is left out of the
  // patch and lands on this build's default (settings.js DEFAULTS).
  const sfxEnabled = audio ? audio.sfx : Number(raw[LEGACY_SFX_DISABLED] ?? 0) === 0;
  const musicEnabled = audio ? audio.music : Number(raw[LEGACY_MUSIC_DISABLED] ?? 0) === 0;
  if (!sfxEnabled) patch.sfxVolume = 0;
  if (!musicEnabled) patch.musicVolume = 0;
  // This build starts muted and firstLaunch.js persists that — right for a new
  // player, wrong for one who had sound on in the old game. Unmute unless they
  // really had turned everything off.
  patch.muted = !sfxEnabled && !musicEnabled;

  return patch;
}

// Merge into the settings blob directly rather than through settings.js: this
// runs before loadSettings(), and saveSettings() would push the patch at an
// audio runtime that hasn't been built yet. The reload right after is what
// makes it take effect. Writing the blob at all also consumes isFirstLaunch(),
// which correctly suppresses the "Audio muted by default" onboarding toast for
// a returning player.
function mergeSettings(patch) {
  try {
    let settings = {};
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) { try { settings = JSON.parse(raw) || {}; } catch { settings = {}; } }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, ...patch }));
  } catch { /* ignore — a save without its settings still beats no save */ }
}

// Boot step. Returns true when a reload is in flight, so main() can stop and
// let the reloaded boot build state from the imported save — same contract as
// bootRestoreFromCloud().
export async function importLegacyFromNative() {
  const native = getNativeState();
  if (!native || alreadyImported()) return false;

  let translated = null;
  if (native.legacy?.save) {
    try {
      translated = translateLegacySave(native.legacy.save);
    } catch (e) {
      // A save file we can't read is not worth a player-facing error at boot —
      // there's nothing they could do about it. Fall through to "skip".
      console.warn("[legacySave] unusable legacy save:", e?.message);
    }
  }

  const decision = legacyImportDecision({
    hasLocalSave: hasLocalProgress(),
    legacyHasProgress: !!translated && legacySaveHasProgress(translated.kv),
  });
  if (decision === "skip") { markLegacyImportDone(); return false; }

  try {
    applyLegacySave(translated.kv);
  } catch (e) {
    // applyLegacySave already rolled back. Leave the marker unset so a boot
    // with more room (quota) retries instead of silently losing the save.
    console.error("[legacySave] native import failed", e);
    return false;
  }
  mergeSettings(legacySettingsPatch(native.legacy.save, native.legacy.audio));
  markLegacyImportDone();
  // The marker is what stops the next boot importing all over again, and it's
  // written best-effort. If it didn't stick, localStorage isn't holding
  // anything — including the import we just wrote — and reloading would land
  // right back here and loop under the loading screen. Carry on with this boot
  // instead; the player sees a running game rather than a hang.
  if (!alreadyImported()) {
    console.error("[legacySave] the import marker did not persist — not reloading");
    return false;
  }
  console.log(`[legacySave] imported ${translated.imported} entries from the previous build`);
  location.reload();
  return true;
}

// — UI entry point ————————————————————————————————————————————————————————
// Pause menu → Settings. Opens a file picker for the old build's save.json,
// confirms the overwrite, imports, and reloads so every module rehydrates from
// the imported values.

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("couldn't read that file"));
    r.readAsText(file);
  });
}

// The picker is created per-invocation and discarded: a persistent hidden
// input would keep the last chosen file and never re-fire `change` if the
// player picked the same one twice.
function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    // A cancelled picker fires no `change` in most browsers; `cancel` is the
    // modern signal. Without it the promise would hang and the menu would
    // look wedged.
    input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickAndImportLegacySave() {
  const file = await pickFile();
  if (!file) return;

  let text;
  try { text = await readFile(file); }
  catch (e) { showMessage("Import failed", e?.message ?? "couldn't read that file"); return; }

  // Translate first so a bad file is rejected before we ask the player to
  // agree to overwriting anything.
  let translated;
  try { translated = translateLegacySave(JSON.parse(text)); }
  catch (e) {
    showMessage("Import failed", e instanceof SyntaxError
      ? "That file isn't valid JSON."
      : (e?.message ?? "unknown error"));
    return;
  }
  if (!legacySaveHasProgress(translated.kv)) {
    showMessage("Nothing to import", "That save has no progress in it.");
    return;
  }

  const ok = await showConfirm({
    title: "Import your old save?",
    text: `Found ${translated.imported} entries. This replaces your current progress — `
        + "inventory, dialogue, unlocked skills and where you're standing.",
    confirmLabel: "Import",
    cancelLabel: "Cancel",
    danger: true,
  });
  if (!ok) return;

  // Stop main.js's beforeunload save from writing the live zone/tile back
  // over the freshly imported one during the reload.
  try { window.save?.suppressUnloadSave?.(); } catch { /* ignore */ }
  try { applyLegacySave(translated.kv); }
  catch (e) { showMessage("Import failed", e?.message ?? "couldn't write the save"); return; }

  // A `?zone=X` override in the URL would beat the imported latest_zone, so
  // reload to the bare path.
  location.replace(location.pathname);
}
