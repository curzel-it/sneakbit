// Loads and caches JSON data (levels, species). Pure I/O — no game logic.

const cache = new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

export async function loadWorld(id) {
  const key = `world:${id}`;
  if (!cache.has(key)) cache.set(key, await fetchJson(`./data/${id}.json`));
  return cache.get(key);
}

export async function loadSpecies() {
  const key = "species";
  if (!cache.has(key)) cache.set(key, await fetchJson("./data/species.json"));
  return cache.get(key);
}
