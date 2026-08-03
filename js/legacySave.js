// Import a save from the pre-rewrite (Rust core) builds — Steam desktop,
// iOS, Android.
//
// Those builds persist a single flat JSON object of `{ "key": u32 }` to
// `storage.json` (game_core/src/features/storage.rs). That is the same shape
// as this port's kv namespace, so an import is mostly a straight copy; only a
// handful of keys were renamed on the way over. Everything else — dialogue
// answers, collected items, npc interactions, lock overrides, pressure
// plates, per-player inventory amounts — already matches key for key.
//
// Pure: translateLegacySave takes the parsed JSON and returns what to write,
// so the mapping is unit-testable without a DOM. importLegacySave applies it.
//
// Where to find storage.json on the old builds:
//   macOS    ~/Library/Application Support/SneakBit/storage.json
//   Windows  %APPDATA%\SneakBit\storage.json
//   Linux    ~/.local/share/SneakBit/storage.json
//   iOS/Android — inside the app's private data dir (needs a backup export)

import { setValue, snapshotStorage, restoreStorage } from "./storage.js";
import { showMessage } from "./message.js";
import { showConfirm } from "./confirmDialog.js";

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
//   is_mobile / fullscreen / language / desktop_only.* — per-device settings,
//                      owned by settings.js on this build.
const DROPPED = new Set(["build_number", "previous_world", "is_mobile", "fullscreen", "language"]);
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

// Turn a parsed legacy storage.json into the kv entries this build wants.
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

// — UI entry point ————————————————————————————————————————————————————————
// Pause menu → Settings. Opens a file picker for the old build's
// storage.json, confirms the overwrite, imports, and reloads so every module
// rehydrates from the imported values.

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
