// Loads and caches sprite-sheet <img> elements keyed by name.
// Features ask `getSprite(name)` rather than constructing Image objects.

const cache = new Map();

const SOURCES = {
  heroes: "./assets/heroes.png",
  tilesBiome1: "./assets/tiles_biome_raw1.png",
  tilesBiome2: "./assets/tiles_biome_raw2.png",
  tilesBiome3: "./assets/tiles_biome_raw3.png",
  tilesBiome4: "./assets/tiles_biome_raw4.png",
  tilesConstructions: "./assets/tiles_constructions_raw.png",
  buildings: "./assets/buildings.png",
  humanoids_1x1: "./assets/humanoids_1x1.png",
  humanoids_1x2: "./assets/humanoids_1x2.png",
  humanoids_2x2: "./assets/humanoids_2x2.png",
  static_objects: "./assets/static_objects.png",
  animated_objects: "./assets/animated_objects.png",
  weapons: "./assets/weapons.png",
  monsters: "./assets/monsters.png",
  inventory: "./assets/inventory.png",
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export async function loadAssets() {
  const entries = await Promise.all(
    Object.entries(SOURCES).map(async ([name, src]) => [name, await loadImage(src)])
  );
  for (const [name, img] of entries) cache.set(name, img);
}

export function getSprite(name) {
  const img = cache.get(name);
  if (!img) throw new Error(`Sprite not loaded: ${name}`);
  return img;
}
