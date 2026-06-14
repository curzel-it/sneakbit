// Tower Defense map roster — the Bloons-style list of playable maps and the
// rules that gate them. Pure data + pure functions only: no storage, no DOM, no
// game state. The run controller (towerDefense.js) reads the roster to drive a
// run; the map-select screen (mapSelect.js) reads it to render the grid;
// persistence lives in tdProgress.js.
//
// A "map" is one procedural slot today: the same forest theme generated at a
// fixed `difficulty` (fed to generateMap as the old mapIndex) with its own
// `waveGoal` — the round you must clear to FINISH (win) the map. Finishing a map
// mid-run auto-promotes the team to the next map in roster order.
//
// Unlocks mirror Bloons: maps are grouped into difficulty TIERS, and a tier
// opens once you've accumulated enough unique-map wins (a "unique win" = a map
// you've finished at least once). Within an unlocked tier you pick any map.

// Tiers in ascending order. `unlockAt` is the number of unique-map wins required
// before the tier's maps become playable. Bloons gates Intermediate at 5 unique
// wins and Advanced at 12; scaled down here to a 9-map roster.
export const TIERS = [
  { id: "beginner", name: "Beginner", unlockAt: 0 },
  { id: "intermediate", name: "Intermediate", unlockAt: 3 },
  { id: "advanced", name: "Advanced", unlockAt: 6 },
];

// The roster, in promotion order. `id` is the stable persistence/selection key,
// `difficulty` seeds generation + enemy scaling, `waveGoal` is the final round.
const ROSTER = [
  { id: "meadow", name: "Meadow", tier: "beginner", difficulty: 0, waveGoal: 10 },
  { id: "grove", name: "Grove", tier: "beginner", difficulty: 1, waveGoal: 10 },
  { id: "creek", name: "Creek", tier: "beginner", difficulty: 2, waveGoal: 11 },
  { id: "ridge", name: "Ridge", tier: "intermediate", difficulty: 3, waveGoal: 12 },
  { id: "hollow", name: "Hollow", tier: "intermediate", difficulty: 4, waveGoal: 12 },
  { id: "marsh", name: "Marsh", tier: "intermediate", difficulty: 5, waveGoal: 13 },
  { id: "summit", name: "Summit", tier: "advanced", difficulty: 6, waveGoal: 13 },
  { id: "gorge", name: "Gorge", tier: "advanced", difficulty: 7, waveGoal: 14 },
  { id: "bastion", name: "Bastion", tier: "advanced", difficulty: 8, waveGoal: 14 },
];

const BY_ID = new Map(ROSTER.map((m) => [m.id, m]));
const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));

// The full roster (a copy, so callers can't mutate the source of truth).
export function mapRoster() {
  return ROSTER.map((m) => ({ ...m }));
}

export function mapById(id) {
  const m = BY_ID.get(id);
  return m ? { ...m } : null;
}

// 0-based position in promotion order, or -1 for an unknown id.
export function mapIndexInRoster(id) {
  return ROSTER.findIndex((m) => m.id === id);
}

// The id of the first map (where a fresh run defaults to).
export function firstMapId() {
  return ROSTER[0].id;
}

// The map promoted to after finishing `id`, or null if `id` is the last map
// (finishing it = full victory, the run ends).
export function nextMapId(id) {
  const i = mapIndexInRoster(id);
  if (i < 0 || i + 1 >= ROSTER.length) return null;
  return ROSTER[i + 1].id;
}

// The final round of a map (clearing it finishes the map). 0 for unknown ids.
export function waveGoalFor(id) {
  const m = BY_ID.get(id);
  return m ? m.waveGoal | 0 : 0;
}

// The generation/scaling difficulty for a map. 0 for unknown ids.
export function difficultyFor(id) {
  const m = BY_ID.get(id);
  return m ? m.difficulty | 0 : 0;
}

// Is a tier unlocked given how many unique maps the player has won?
export function tierUnlocked(tierId, uniqueWins) {
  const t = TIER_BY_ID.get(tierId);
  if (!t) return false;
  return (uniqueWins | 0) >= t.unlockAt;
}

// Is a specific map unlocked? A map is unlocked iff its tier is unlocked.
// `progress` is the object from tdProgress.getProgress() (only uniqueWins read).
export function mapUnlocked(id, progress) {
  const m = BY_ID.get(id);
  if (!m) return false;
  return tierUnlocked(m.tier, progress?.uniqueWins | 0);
}

// A render-ready view of the roster for the map-select screen: tiers in order,
// each with its maps decorated with unlock state + the player's wins/best round,
// plus how many more unique wins unlock a locked tier.
export function unlockSummary(progress) {
  const uniqueWins = progress?.uniqueWins | 0;
  const winsById = progress?.winsById || {};
  const bestById = progress?.bestById || {};
  return TIERS.map((t) => {
    const unlocked = uniqueWins >= t.unlockAt;
    const maps = ROSTER.filter((m) => m.tier === t.id).map((m) => ({
      ...m,
      unlocked,
      wins: winsById[m.id] | 0,
      bestRound: bestById[m.id] | 0,
    }));
    return {
      id: t.id,
      name: t.name,
      unlocked,
      unlockAt: t.unlockAt,
      winsToUnlock: Math.max(0, t.unlockAt - uniqueWins),
      maps,
    };
  });
}
