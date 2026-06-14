// Tower Defense persistent progress — wins, best rounds, and the unique-win
// count that gates tier unlocks. A thin wrapper over storage.js (integer kv,
// localStorage-backed, auto cloud-synced under the "td.*" namespace).
//
// storage.js has no key enumeration, so we keep an explicit `td.uniqueWins`
// aggregate (bumped the first time a given map is won) rather than scanning.
// Persistence is host/solo only — guests mirror the host's run and never write
// here (the caller enforces that via net role).

import { getValue, setValue } from "./storage.js";
import { mapRoster } from "./tdMaps.js";

const UNIQUE_WINS_KEY = "td.uniqueWins";
const winsKey = (id) => `td.map.${id}.wins`;
const bestKey = (id) => `td.map.${id}.bestRound`;

// Record finishing (winning) a map. Bumps that map's win count, advances the
// unique-win aggregate the first time the map is ever won, and folds in the
// round reached as a best-round update. Returns the new win count for the map.
export function recordMapWin(id, roundReached = 0) {
  if (!id) return 0;
  const prevWins = getValue(winsKey(id)) | 0;
  const wins = prevWins + 1;
  setValue(winsKey(id), wins);
  if (prevWins === 0) {
    setValue(UNIQUE_WINS_KEY, (getValue(UNIQUE_WINS_KEY) | 0) + 1);
  }
  recordRoundReached(id, roundReached);
  return wins;
}

// Track the deepest round reached on a map (even on a loss), for the select
// screen's per-map "best" badge. Monotonic — only writes when it's a new best.
export function recordRoundReached(id, round) {
  if (!id) return;
  const r = round | 0;
  if (r <= 0) return;
  if (r > (getValue(bestKey(id)) | 0)) setValue(bestKey(id), r);
}

// The full progress snapshot the roster helpers + map-select screen consume.
export function getProgress() {
  const winsById = {};
  const bestById = {};
  for (const m of mapRoster()) {
    winsById[m.id] = getValue(winsKey(m.id)) | 0;
    bestById[m.id] = getValue(bestKey(m.id)) | 0;
  }
  return { winsById, bestById, uniqueWins: getValue(UNIQUE_WINS_KEY) | 0 };
}

// Wipe all TD progression (dev/test). Leaves td.highScore alone.
export function resetProgress() {
  for (const m of mapRoster()) {
    setValue(winsKey(m.id), null);
    setValue(bestKey(m.id), null);
  }
  setValue(UNIQUE_WINS_KEY, null);
}
