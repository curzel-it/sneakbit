// Boss minion-spawning AI. Mirrors Rust features/monsters.rs::spawn_minions_if_needed.
//
// The "grapevine" boss (species 4008) periodically spawns "grapeberry"
// minions (species 4009 — a normal 1×1 CloseCombatMonster) when the
// player is within line-of-sight but far enough away that the boss
// can't melee them itself. The minions take over from there: they're
// picked up by mobs.js's FindHero AI and chase the player on foot.
//
// This is the JS port of what the todo.md calls "ranged monsters" —
// the only attack-from-range mechanic shipped in the Rust core's data.

import { getSpecies } from "./species.js";

const BOSS_SPECIES_ID = 4008;
const MIN_SPAWN_DISTANCE = 3.5;        // tiles between boss centre and player centre
const MAX_SPAWN_DISTANCE = 12;         // line-of-sight cap (Manhattan)
const DEFAULT_COOLDOWN = 1.5;          // seconds, used if species data omits it

let spawnCounter = 0;
let nextMinionId = -1_000_000; // negative ids stay clear of zone-loaded entity ids

export function tickMinionSpawning(zone, player, dt) {
  if (!zone?.entities || !player) return;
  // Only spawn minions for bosses currently on screen — matches Rust's
  // visibility-gated update path. An off-screen boss freezes its cooldown.
  const list = zone.visibleEntities ?? zone.entities;
  for (const e of list) {
    if (e.species_id !== BOSS_SPECIES_ID) continue;
    if (e._spawned || e._dying) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    const minionSpeciesId = sp.bullet_species_id;
    if (!minionSpeciesId) continue;

    e._minionCooldown = Math.max(0, (e._minionCooldown ?? 0) - dt);
    if (e._minionCooldown > 0) continue;

    if (!playerInRange(e, player)) continue;

    spawnMinion(zone, e, minionSpeciesId);
    const base = sp.cooldown_after_use > 0 ? sp.cooldown_after_use : DEFAULT_COOLDOWN;
    // Match Rust's deterministic random jitter so the cadence isn't a perfect
    // metronome.
    const jitter = (spawnCounter++ % 2 === 0) ? 0.8 : 1.2;
    e._minionCooldown = base * jitter;
  }
}

function playerInRange(boss, player) {
  const f = boss.frame;
  const bcx = f.x + (f.w || 1) * 0.5;
  const bcy = f.y + (f.h || 1) * 0.5;
  const pcx = player.x + 0.5;
  const pcy = player.y + 0.5;
  const dx = pcx - bcx;
  const dy = pcy - bcy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < MIN_SPAWN_DISTANCE) return false;
  if (Math.abs(dx) + Math.abs(dy) > MAX_SPAWN_DISTANCE) return false;
  return true;
}

function spawnMinion(zone, boss, minionSpeciesId) {
  const f = boss.frame;
  const cx = f.x + (f.w || 1) * 0.5;
  const cy = f.y + (f.h || 1) * 0.5;
  const minionSp = getSpecies(minionSpeciesId);
  const mw = minionSp?.width || 1;
  const mh = minionSp?.height || 1;
  const minion = {
    id: nextMinionId--,
    species_id: minionSpeciesId,
    direction: boss.direction || "Down",
    is_consumable: false,
    frame: {
      x: cx - mw * 0.5,
      y: cy - mh * 0.5,
      w: mw,
      h: mh,
    },
    dialogues: [],
  };
  zone.entities.push(minion);
}

// Test-only hook to reset module state between tests.
export function _resetMinionsForTesting() {
  spawnCounter = 0;
  nextMinionId = -1_000_000;
}
