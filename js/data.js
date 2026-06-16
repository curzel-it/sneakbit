// Loads and caches JSON data (levels, species). Pure I/O — no game logic.

import { isCreativeMode } from "./creativeMode.js";
import { loadEditedWorld } from "./editedWorlds.js";

const cache = new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  // A 200 isn't proof of JSON: a server/proxy that serves an SPA fallback
  // page for unknown paths (prod nginx does this) answers a missing file
  // with 200 + HTML. res.json() would then throw the opaque
  // "Unexpected token '<', "<!DOCTYPE "... is not valid JSON" far from the
  // cause. Catch it here and rethrow with the URL so callers can react.
  try {
    return await res.json();
  } catch {
    throw new Error(`Non-JSON response for ${url} (status ${res.status}) — file missing or path not served`);
  }
}

// Creative mode: consult the server-side edited-world store before falling
// back to the shipped JSON. The override holds the same raw schema as the
// shipped file (no rebuild step in between), so the rest of the load pipeline
// doesn't change. The per-id cache key carries a `creative:` namespace so
// toggling the flag mid-session can't serve stale shipped JSON in place of an
// override (and vice versa). loadEditedWorld() returns null for non-editors /
// offline / unedited zones, so play falls through to the shipped file.
export async function loadZone(id) {
  const creative = isCreativeMode();
  const key = creative ? `zone:creative:${id}` : `zone:${id}`;
  if (cache.has(key)) return cache.get(key);
  if (creative) {
    const edited = await loadEditedWorld(id);
    if (edited) {
      cache.set(key, edited);
      return edited;
    }
  }
  const raw = await fetchJson(`./data/${id}.json`);
  cache.set(key, raw);
  return raw;
}

// Editor support: drop the cached entry for a zone so the next
// loadZone() call refetches (from the server edited-world store, then the
// shipped JSON). Used by the Reset-zone menu action and after a save.
export function invalidateZoneCache(id) {
  cache.delete(`zone:${id}`);
  cache.delete(`zone:creative:${id}`);
}

export async function loadSpecies() {
  const key = "species";
  if (!cache.has(key)) cache.set(key, await fetchJson("./data/species.json"));
  return cache.get(key);
}

export async function loadStrings(lang = "en") {
  const key = `strings:${lang}`;
  if (!cache.has(key)) cache.set(key, await fetchJson(`./data/strings.${lang}.json`));
  return cache.get(key);
}
