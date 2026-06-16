// Creative-mode zone authoring tools, reached from the pause menu's Creative
// screen. Creative mode is local-only (see creativeMode.js); these actions
// write the live zone straight into this repo's data/<id>.json via the File
// System Access API (localZoneFiles.js), download its raw JSON, or reload it
// from disk. Split out of menu.js since they're a self-contained feature; the
// menu wires its buttons to these handlers and hands us the live-state getter
// via initCreativeZoneTools.

import { el } from "./dom.js";
import {
  connectDataDir, isDataDirConnected, flushZoneFile, isFileSystemAccessSupported,
} from "./localZoneFiles.js";
import { invalidateZoneCache, loadZone } from "./data.js";
import { buildZone } from "./zone.js";
import { setupPuzzles } from "./puzzles.js";
import { setupCutscenes } from "./cutscenes.js";
import { getZoneCache } from "./zoneCache.js";
import { showMessage } from "./message.js";
import { showConfirm } from "./confirmDialog.js";

// () => ({ zone, rawZone, ... }) | null — the live game state. Wired by
// the menu at install so this module doesn't reach into main.js.
let getState = () => null;

export function initCreativeZoneTools(stateGetter) {
  if (typeof stateGetter === "function") getState = stateGetter;
}

// Grant the repo's data/ folder so edits can be written to disk. Must run from
// a user gesture (the menu button click). Once granted, the editor's automatic
// per-edit writes (mapEditor.js) and saveZoneNow flush silently.
export async function connectDataFolder() {
  if (!isFileSystemAccessSupported()) {
    showMessage("Unsupported", "File System Access needs Chrome or Edge, running locally.");
    return;
  }
  const res = await connectDataDir();
  if (res.ok) showMessage("Data folder connected", `Writing edits to ${res.name}/<id>.json.`);
  else showMessage("Not connected", res.reason ?? "Could not connect the data/ folder.");
}

// Write the in-memory raw zone JSON to data/<id>.json now. Mirrors the Rust
// desktop's "Save" menu action. Useful between teleports so creative work is on
// disk even if the tab is closed before the next zone transition.
export async function saveZoneNow() {
  const st = getState();
  const id = st?.zone?.id;
  const raw = st?.rawZone;
  if (!id || !raw) { showMessage("Save zone", "No zone is loaded yet."); return; }
  if (!isDataDirConnected()) { showMessage("Save zone", "Connect the data/ folder first."); return; }
  try {
    const ok = await flushZoneFile(id, raw);
    invalidateZoneCache(id);
    if (ok) showMessage("Zone saved", `Wrote data/${id}.json.`);
    else showMessage("Save failed", "Could not write the file.");
  } catch (e) {
    showMessage("Save failed", e?.message ?? "unknown error");
  }
}

// Download the current zone's raw JSON as `{id}.json` — a no-FS fallback for
// browsers without the File System Access API. The author drops the file into
// ./data/ and commits.
export function exportZone() {
  const st = getState();
  const id = st?.zone?.id;
  const raw = st?.rawZone;
  if (!id || !raw) { showMessage("Export zone", "No zone is loaded yet."); return; }
  const json = JSON.stringify(raw, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `${id}.json` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick — Firefox cancels the download if the URL is
  // freed before the browser starts streaming the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Re-read the current zone's data/<id>.json from disk and rebuild the live
// zone from it, discarding any unsaved in-memory edits. Use this after
// reverting a file on disk (e.g. `git checkout data/<id>.json`).
export async function reloadZoneFromDisk() {
  const st = getState();
  const id = st?.zone?.id;
  if (!id) { showMessage("Reload zone", "No zone is loaded yet."); return; }
  const ok = await showConfirm({
    title: `Reload zone ${id} from disk?`,
    text: "Re-reads data/" + id + ".json and discards any unsaved in-memory edits.",
    confirmLabel: "Reload",
    danger: true,
  });
  if (!ok) return;
  try {
    invalidateZoneCache(id);
    const raw = await loadZone(id);
    const next = buildZone(raw);
    setupPuzzles(next);
    setupCutscenes(next);
    if (st.zone?.spawnPoint) next.spawnPoint = st.zone.spawnPoint;
    getZoneCache(next);
    st.rawZone = raw;
    st.zone = next;
    showMessage("Zone reloaded", `Reloaded zone ${id} from disk.`);
  } catch (e) {
    showMessage("Reload failed", e?.message ?? "unknown error");
  }
}
