// Player ranged attack: press F (or the on-screen knife button) to throw a
// kunai. We spawn a Bullet entity that travels in the player's facing
// direction. pickups.js leaves player-spawned bullets alone (via the
// _spawned flag) so the thrown kunai doesn't re-collect itself.
//
// Bullet/entity collision is handled in combat.js — here we only spawn
// bullets and advance them through space. The bullet is removed when it
// runs out of lifespan or leaves the world bounds; combat.js removes
// bullets that hit walls or kill targets.

import { getSpecies } from "./species.js";
import { getAmmo, removeAmmo } from "./inventory.js";
import { playSfx } from "./audio.js";
import { getEquipped, SLOT_RANGED } from "./equipment.js";
import { matchesAction } from "./keyBindings.js";
import { isCoopMode, COOP_KEYMAPS } from "./coopMode.js";

const KUNAI_BULLET_SPECIES_ID = 7000;
const BULLET_SPEED = 9;           // fallback: kunai base_speed
const BULLET_LIFESPAN = 1.6;      // fallback when species lifespan missing
const COOLDOWN = 0.35;            // fallback when weapon.cooldown_after_use==0
const MAX_PLAYERS = 2;

// Maps Rust EquipmentUsageSoundEffect → audio.js sfx names.
const SFX_FOR_USAGE = {
  SwordSlash:  "swordSlash",
  GunShot:     "gunShot",
  LoudGunShot: "loudGunShot",
  KnifeThrown: "knifeThrown",
  NoAmmo:      "noAmmo",
};

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

let stateRef = null;
const cooldown = new Float32Array(MAX_PLAYERS);
let nextBulletId = 1;

export function installShooting(getState) {
  stateRef = getState;
  window.addEventListener("keydown", onKey);
}

export function tickShooting(dt) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (cooldown[i] > 0) cooldown[i] = Math.max(0, cooldown[i] - dt);
  }
  const state = stateRef?.();
  if (!state) return;
  advanceBullets(state, dt);
}

// Exposed so the touch action button can trigger a shot.
export function tryShoot() {
  const state = stateRef?.();
  if (!state) return;
  shoot(state, state.player);
}

function onKey(e) {
  if (e.repeat) return;
  const state = stateRef?.();
  if (!state) return;
  const shooter = pickShooter(state, e.code);
  if (!shooter) return;
  e.preventDefault();
  shoot(state, shooter);
}

function pickShooter(state, code) {
  if (isCoopMode()) {
    if (code === COOP_KEYMAPS[1].shoot) return state.player;
    if (code === COOP_KEYMAPS[2].shoot) return state.player2 || state.player;
    return null;
  }
  return matchesAction("shoot", code) ? state.player : null;
}

function shoot(state, shooter) {
  const idx = (shooter?.index | 0) || 0;
  if (cooldown[idx] > 0) return;
  const { weapon, bulletId } = resolveRangedWeapon(idx);
  const bulletSp = getSpecies(bulletId);
  if (!bulletSp) return;
  if (getAmmo(bulletId, idx) <= 0) { playSfx("noAmmo"); return; }
  if (!removeAmmo(bulletId, 1, idx)) return;
  cooldown[idx] = (weapon?.cooldown_after_use > 0) ? weapon.cooldown_after_use : COOLDOWN;

  const dir = shooter.direction;
  const [dx, dy] = DIR_DELTA[dir] ?? DIR_DELTA.down;
  const speed = bulletSp.base_speed > 0 ? bulletSp.base_speed : BULLET_SPEED;
  const lifespan = (weapon?.bullet_lifespan > 0) ? weapon.bullet_lifespan : BULLET_LIFESPAN;
  // Spawn one tile ahead of the player so the bullet doesn't start
  // overlapping the player's own hitbox.
  const bullet = {
    id: -(nextBulletId++),
    _spawned: true,
    _vx: dx * speed,
    _vy: dy * speed,
    _lifespan: lifespan,
    _playerIndex: idx,
    species_id: bulletId,
    is_consumable: false,
    direction: capitalize(dir),
    frame: {
      x: shooter.tileX + dx,
      y: shooter.tileY + dy,
      w: 1,
      h: 1,
    },
    dialogues: [],
  };
  state.world.entities.push(bullet);
  playSfx(SFX_FOR_USAGE[weapon?.equipment_usage_sound_effect] || "knifeThrown");
}

// Picks the equipped ranged weapon's bullet species, falling back to the
// kunai bullet so the game keeps working when no species data is loaded
// (tests) or when equipment storage is empty in an unusual way.
function resolveRangedWeapon(playerIndex) {
  const weaponId = getEquipped(SLOT_RANGED, playerIndex);
  const weapon = weaponId ? getSpecies(weaponId) : null;
  if (weapon && weapon.entity_type === "WeaponRanged" && weapon.bullet_species_id) {
    return { weapon, bulletId: weapon.bullet_species_id };
  }
  return { weapon: null, bulletId: KUNAI_BULLET_SPECIES_ID };
}

function advanceBullets(state, dt) {
  const ents = state.world.entities;
  const world = state.world;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    if (!e._spawned) continue;
    const f = e.frame;
    f.x += e._vx * dt;
    f.y += e._vy * dt;
    e._lifespan -= dt;
    if (
      e._lifespan <= 0 ||
      f.x < -1 || f.y < -1 ||
      f.x > world.cols || f.y > world.rows
    ) {
      ents.splice(i, 1);
    }
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
