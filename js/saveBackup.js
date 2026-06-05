// Manual save backup: export every sneakbit.* localStorage key to a JSON
// blob the player can stash, and import one back. Reachable from the pause
// menu's Settings → (creative) tools, but the mechanism is plain
// localStorage + clipboard with no menu/game coupling, so it lives on its
// own. The menu just wires its buttons to these two handlers.

import { showMessage } from "./message.js";
import { showConfirm } from "./confirmDialog.js";

// Snapshot every sneakbit.* localStorage key into a JSON blob and try to
// copy it to the clipboard; on failure (clipboard API blocked, http
// without secure-context) fall back to a textarea-and-Ctrl-C prompt so
// the player can still grab it.
export async function exportSave() {
  const payload = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sneakbit.")) continue;
      payload[k] = localStorage.getItem(k);
    }
  } catch {}
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: payload });
  try {
    await navigator.clipboard.writeText(json);
    showMessage("Save exported", `Copied to clipboard (${Object.keys(payload).length} keys).`);
  } catch {
    prompt("Save export — copy the text below:", json);
  }
}

// Replace the current sneakbit.* localStorage payload with the contents
// of a pasted JSON blob (produced by exportSave). Reloads on success so
// every module hydrates fresh from the restored values.
export async function importSave() {
  const json = prompt("Paste your previously-exported save JSON:");
  if (!json) return;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    showMessage("Import failed", "That doesn't look like valid JSON.");
    return;
  }
  if (!parsed?.entries || typeof parsed.entries !== "object") {
    showMessage("Import failed", "Missing 'entries' object in save payload.");
    return;
  }
  const ok = await showConfirm({
    title: "Overwrite your save?",
    text: "Importing will replace your current progress with the pasted save.",
    confirmLabel: "Overwrite",
    danger: true,
  });
  if (!ok) return;
  try { window.save?.suppressUnloadSave?.(); } catch {}
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sneakbit.")) localStorage.removeItem(k);
    }
    for (const [k, v] of Object.entries(parsed.entries)) {
      if (typeof k === "string" && k.startsWith("sneakbit.") && typeof v === "string") {
        localStorage.setItem(k, v);
      }
    }
  } catch (e) {
    showMessage("Import failed", e?.message ?? "unknown error");
    return;
  }
  location.replace(location.pathname);
}
