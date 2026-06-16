// Loads and caches JSON data (levels, species). Pure I/O — no game logic.

import { isCreativeMode } from "./creativeMode.js";

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

// Creative mode writes edits straight into the repo's data/<id>.json (see
// localZoneFiles.js), so loads just fetch the shipped file — it already
// reflects any edits. In creative mode we add a cache-buster so a reload right
// after a disk write bypasses the HTTP cache and reads the fresh bytes.
export async function loadZone(id) {
  const key = `zone:${id}`;
  if (cache.has(key)) return cache.get(key);
  const url = isCreativeMode() ? `./data/${id}.json?t=${Date.now()}` : `./data/${id}.json`;
  const raw = await fetchJson(url);
  cache.set(key, raw);
  return raw;
}

// Editor support: drop the cached entry for a zone so the next loadZone()
// refetches from disk. Used by the Reload-from-disk menu action and after a
// save.
export function invalidateZoneCache(id) {
  cache.delete(`zone:${id}`);
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
