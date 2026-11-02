// Soft push-apart so bodies don't stack: players drift away from each other,
// and monsters are shoved out of players (a player walking into a monster
// nudges it aside). Monsters among themselves don't separate, so two that
// end up on top of each other still fuse (monsters.js). Network-driven guest
// avatars are never moved here: their own client owns their position.

import { getSpecies } from "./species.js";
import { isFrozen } from "./freeze.js";
import { canHeroOccupy } from "./heroCollision.js";
import { isMobAi, mobFeetCentre, moveMob } from "./mobs.js";

const PLAYER_RADIUS = 0.3;
const MOB_RADIUS_PER_WIDTH = 0.3;
const PUSH_RATE = 8;

/**
 * @param {any} zone
 * @param {any[]} players live players
 * @param {number} dt
 * @param {(p: any) => boolean} [isRemote] true for avatars this sim must not move
 */
export function tickSeparation(zone, players, dt, isRemote = () => false) {
  if (!zone?.entities || !players.length) return;
  const k = Math.min(1, PUSH_RATE * dt);
  separatePlayers(zone, players, k, isRemote);
  separateMobs(zone, players, k);
}

function separatePlayers(zone, players, k, isRemote) {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const aFixed = isRemote(a), bFixed = isRemote(b);
      if (aFixed && bFixed) continue;
      const push = overlapPush(b.x - a.x, b.y - a.y, PLAYER_RADIUS * 2, i, j);
      if (!push) continue;
      const share = aFixed || bFixed ? 1 : 0.5;
      if (!aFixed) nudgePlayer(zone, a, -push.x * share * k, -push.y * share * k);
      if (!bFixed) nudgePlayer(zone, b, push.x * share * k, push.y * share * k);
    }
  }
}

function separateMobs(zone, players, k) {
  const list = zone.visibleEntities ?? zone.entities;
  for (const e of list) {
    if (e._spawned || e._dying || !e.frame) continue;
    const sp = getSpecies(e.species_id);
    if (!isMobAi(sp) || isFrozen(e) || e._ai?.step) continue;
    const radius = MOB_RADIUS_PER_WIDTH * Math.max(1, e.frame.w || 1);
    for (const p of players) {
      const feet = mobFeetCentre(e);
      const push = overlapPush(feet.x - (p.x + 0.5), feet.y - (p.y + 0.5), radius + PLAYER_RADIUS, 0, 1);
      if (!push) continue;
      moveMob(zone, e, push.x * k, push.y * k);
    }
  }
}

// Vector along (dx, dy) that would separate two circles `minDist` apart, or
// null when they don't overlap. Coincident bodies split along an axis picked
// from their indices so the push is deterministic.
function overlapPush(dx, dy, minDist, i, j) {
  const dist = Math.hypot(dx, dy);
  if (dist >= minDist) return null;
  if (dist < 1e-6) return (i + j) % 2 ? { x: minDist, y: 0 } : { x: 0, y: minDist };
  const depth = minDist - dist;
  return { x: (dx / dist) * depth, y: (dy / dist) * depth };
}

function nudgePlayer(zone, p, dx, dy) {
  if (canHeroOccupy(zone, p.x, p.y, p.x + dx, p.y + dy)) {
    p.x += dx;
    p.y += dy;
    p.tileX = Math.round(p.x);
    p.tileY = Math.round(p.y);
  }
}
