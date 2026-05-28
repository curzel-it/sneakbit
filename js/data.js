// Loads and caches JSON data (levels, species). Pure I/O — no game logic.

import { isCreativeMode } from "./creativeMode.js?v=20260528f";
import { getBufferedZone } from "./zoneBuffer.js?v=20260528f";

const cache = new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

// Creative mode: consult the IndexedDB zone override store before
// falling back to the shipped JSON. The override holds the same raw
// schema as the shipped file (no rebuild step in between), so the rest
// of the load pipeline doesn't change. The per-id cache key carries a
// `creative:` namespace so toggling the flag mid-session can't serve
// stale shipped JSON in place of an override (and vice versa).
export async function loadZone(id) {
  const creative = isCreativeMode();
  const key = creative ? `zone:creative:${id}` : `zone:${id}`;
  if (cache.has(key)) return cache.get(key);
  if (creative) {
    const buffered = await getBufferedZone(id);
    if (buffered) {
      cache.set(key, buffered);
      return buffered;
    }
  }
  const raw = await fetchJson(`./data/${id}.json`);
  cache.set(key, raw);
  return raw;
}

// Editor support: drop the cached entry for a zone so the next
// loadZone() call goes back to disk (or back to IndexedDB). Used by
// the Reset-zone menu action and after a buffered save.
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
