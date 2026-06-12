// Web Worker that runs the Sokoban solver off the main thread, so a slow
// puzzle solve (Defect B: the hardest dungeon can take seconds) never freezes
// the page — the bot idles or busy-walks while it thinks (plan §5.6). The
// autoplay analysis modules are DOM-free, so they import cleanly here; the
// worker has no localStorage, so storage.js falls back to its in-memory cache
// which we seed from the snapshot the main thread sends.

import { buildZoneModel } from "./worldModel.js";
import { solveToTiles } from "./puzzleSolver.js";
import { loadSpeciesData } from "../species.js";
import { restoreStorage } from "../storage.js";

let speciesLoaded = false;

self.onmessage = (e) => {
  const { id, raw, species, snapshot, startTile, goalTiles, pushableStarts, maxStates, barrelsBlock } = e.data || {};
  try {
    if (species && !speciesLoaded) { loadSpeciesData(species); speciesLoaded = true; }
    // Seed the worker's storage cache so shouldBeVisible (collected pickups,
    // display conditions) reflects the live save during the solve.
    restoreStorage(snapshot || {});
    const model = buildZoneModel(raw);
    const starts = Array.isArray(pushableStarts)
      ? new Map(pushableStarts.map((p) => [p.id, { x: p.x, y: p.y }]))
      : undefined;
    const solve = solveToTiles(model, startTile, goalTiles, { pushableStarts: starts, maxStates, barrelsBlock });
    self.postMessage({ id, ok: true, solve });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
