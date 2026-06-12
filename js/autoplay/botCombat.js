// Survival layer for the autoplay bot. SneakBit's melee monsters are
// non-rigid (the hero walks through them, taking contact damage) and are
// bullet-sponges (80–4800 HP — a handful of kunai can't dent them), so they
// are designed to be OUT-RUN, not cleared. The robust 24/7 behavior is
// therefore avoidance, not combat:
//
//   - While healthy, IGNORE monsters and keep navigating — the hero pushes
//     straight through them and out-runs the chasers, and HP regenerates.
//     (Reacting to every nearby monster freezes all progress: flee-vs-nav
//     tug-of-war oscillates the hero between two tiles at a guarded corridor
//     forever. That was the prototype's nav-oscillation lesson.)
//   - Only when HURT and a monster is right on top of us do we break away,
//     fleeing to the walkable neighbor that opens the most distance, until
//     HP regen brings us back and navigation resumes.
//
// Death is handled in bot.js (the game-over overlay is dismissed by the
// dialogue janitor → respawn at the zone spawn point).

import { getSpecies } from "../species.js";
import { shouldBeVisible } from "../entityVisibility.js";
import { isDying } from "../deathAnimation.js";
import { getPlayerHp, getPlayerMaxHp } from "../playerHealth.js";
import { isNavWalkable } from "./botNav.js";

// A monster only triggers a defensive reaction inside this Manhattan range.
const DANGER_RANGE = 2;
// Monsters within this range are folded into the flee direction so we break
// away from a cluster, not just the single nearest.
const CLUSTER_RANGE = 4;
// Flee once HP drops to this fraction — above it, navigation's avoid-halo
// keeps us clear and we push through the chip damage. Fleeing on mere
// adjacency instead got the bot stuck dancing beside monster clusters
// forever (flee-vs-nav), so survival is gated on HP, not proximity.
const LOW_HP_FRACTION = 0.4;

const DIRS = [
  { name: "up", dx: 0, dy: -1 },
  { name: "down", dx: 0, dy: 1 },
  { name: "left", dx: -1, dy: 0 },
  { name: "right", dx: 1, dy: 0 },
];

// Returns null when nothing needs handling (orchestrator keeps navigating),
// or a movement intent for bot.js:
//   { flee: dir }  — step away to break contact (hero out-runs chasers)
//   { hold: true } — cornered while hurt; brace and hope for regen
export function decideCombat(state) {
  const player = state.player;
  const zone = state.zone;
  if (!player || !zone) return null;

  const monsters = nearbyMonsters(zone, player, CLUSTER_RANGE);
  const threat = monsters[0]; // nearest, if any
  if (!threat || threat.dist > DANGER_RANGE) return null;

  // Only break away once hurt — otherwise the avoid-halo routing keeps us
  // clear and we push through (these monsters out-HP any weapon we have, so
  // the only winning move is to keep moving).
  const hp = getPlayerHp(player.index | 0);
  const maxHp = getPlayerMaxHp(player.index | 0);
  if (hp > maxHp * LOW_HP_FRACTION) return null;

  const away = fleeDir(zone, player, monsters);
  if (away) return { flee: away };
  return { hold: true }; // cornered — brace
}

// Tiles to route navigation AROUND: each nearby monster's feet tile plus its
// 4 neighbors, for monsters within `range` of the player. Keeps the hero a
// tile clear of wandering monsters without a permanent avoid-overlay (the
// path BFS treats these as blocked but falls back to push-through when they
// seal a corridor — see botNav).
export function monsterHalo(zone, player, range = 10) {
  const halo = new Set();
  for (const m of nearbyMonsters(zone, player, range)) {
    halo.add(`${m.tile.x},${m.tile.y}`);
    for (const d of DIRS) halo.add(`${m.tile.x + d.dx},${m.tile.y + d.dy}`);
  }
  return halo;
}

// Live CloseCombatMonsters within `range`, nearest first.
function nearbyMonsters(zone, player, range) {
  const out = [];
  for (const e of zone.entities) {
    if (!e.frame) continue;
    const sp = getSpecies(e.species_id);
    if (!sp || sp.entity_type !== "CloseCombatMonster") continue;
    if (e._dying || isDying(e) || !shouldBeVisible(e)) continue;
    const tile = { x: e.frame.x | 0, y: (e.frame.y + (e.frame.h | 0 || 1) - 1) | 0 };
    const dist = Math.abs(tile.x - player.tileX) + Math.abs(tile.y - player.tileY);
    if (dist <= range) out.push({ entity: e, tile, dist });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// The walkable cardinal step that most increases the summed distance to the
// nearby monsters, or null if no neighbor improves it (truly cornered).
function fleeDir(zone, player, monsters) {
  let best = null;
  let bestScore = sumDist(player.tileX, player.tileY, monsters);
  for (const d of DIRS) {
    const nx = player.tileX + d.dx;
    const ny = player.tileY + d.dy;
    if (!isNavWalkable(zone, nx, ny)) continue;
    const score = sumDist(nx, ny, monsters);
    if (score > bestScore) { bestScore = score; best = d.name; }
  }
  return best;
}

function sumDist(x, y, monsters) {
  let s = 0;
  for (const m of monsters) s += Math.abs(m.tile.x - x) + Math.abs(m.tile.y - y);
  return s;
}
