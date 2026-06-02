// Creative-mode zone authoring tools, reached from the pause menu's
// Creative screen: save the live zone to the server's edited-worlds
// store, download its raw JSON to ship into ./data/, or revert it to the
// shipped version. These mirror the Rust desktop build's "Save" menu
// actions (only shown in GameMode::Creative). Split out of menu.js since
// they're a self-contained feature; the menu wires its buttons to these
// handlers and hands us the live-state getter via initCreativeZoneTools.

import { el } from "./dom.js";
import { saveEditedWorld, revertEditedWorld } from "./editedWorlds.js";
import { invalidateZoneCache } from "./data.js";

// () => ({ zone, rawZone, ... }) | null — the live game state. Wired by
// the menu at install so this module doesn't reach into main.js.
let getState = () => null;

export function initCreativeZoneTools(stateGetter) {
  if (typeof stateGetter === "function") getState = stateGetter;
}

// Flush the in-memory raw zone JSON to the IndexedDB override buffer
// without leaving the current zone. Mirrors the Rust desktop's "Save"
// menu action — engine.save() writes the current zone to disk on
// demand. Useful between teleports so creative work is durable even if
// the tab is closed before the next zone transition.
export async function saveZoneNow() {
  const st = getState();
  const id = st?.zone?.id;
  const raw = st?.rawZone;
  if (!id || !raw) { alert("No zone is loaded yet."); return; }
  try {
    const ok = await saveEditedWorld(id, raw);
    invalidateZoneCache(id);
    if (ok) alert(`Saved zone ${id} to the server.`);
    else alert(`Save failed: sign in as an editor first.`);
  } catch (e) {
    alert(`Save failed: ${e?.message ?? "unknown error"}`);
  }
}

// Download the current zone's raw JSON as `{id}.json`. The author drops
// the file into ./data/ and commits — that's the canonical "ship the
// edit" path described in creative-mode-requirements.md.
export function exportZone() {
  const st = getState();
  const id = st?.zone?.id;
  const raw = st?.rawZone;
  if (!id || !raw) { alert("No zone is loaded yet."); return; }
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

// Delete the server-side edited world for the current zone. The next
// reload (or teleport back) falls through to the shipped ./data/{id}.json.
export async function resetZone() {
  const st = getState();
  const id = st?.zone?.id;
  if (!id) { alert("No zone is loaded yet."); return; }
  if (!confirm(`Reset zone ${id} to the shipped version? Any server-stored creative edits will be discarded.`)) return;
  try {
    const ok = await revertEditedWorld(id);
    invalidateZoneCache(id);
    if (ok) alert(`Reverted zone ${id} to shipped. Reload (or teleport in/out) to see it.`);
    else alert(`Reset failed: sign in as an editor first.`);
  } catch (e) {
    alert(`Reset failed: ${e?.message ?? "unknown error"}`);
  }
}
