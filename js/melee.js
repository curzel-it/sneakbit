// Player melee attack: press G (or the on-screen melee button) to swing
// the equipped melee weapon. Mirrors Rust equipment/melee.rs: spawns five
// short-lived bullet entities in a cross pattern around the hero (center
// + four cardinals). Each bullet deals bullet_species.dps *
// weapon.melee_dps_multiplier, applied via combat.js's normal bullet
// resolution path.

import { getSpecies } from "./species.js";
import { getEquipped, SLOT_MELEE } from "./equipment.js";
import { playSfx } from "./audio.js";

const DEFAULT_COOLDOWN = 0.35;
const DEFAULT_LIFESPAN = 0.4;

// Bullet offsets around the hero, mirroring Rust bullet_offsets():
// center + 4 cardinals.
const BULLET_OFFSETS = [
  [ 0,  0],
  [ 0, -1],
  [ 1,  0],
  [-1,  0],
  [ 0,  1],
];

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

const SFX_FOR_USAGE = {
  SwordSlash:  "swordSlash",
  GunShot:     "gunShot",
  LoudGunShot: "loudGunShot",
  KnifeThrown: "knifeThrown",
};

let stateRef = null;
let cooldown = 0;
let nextBulletId = 1;

export function installMelee(getState) {
  stateRef = getState;
  window.addEventListener("keydown", onKey);
}

export function tickMelee(dt) {
  if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
}

// Touch button entry point — parity with shooting.tryShoot.
export function tryMelee() {
  const state = stateRef?.();
  if (!state) return;
  swing(state);
}

function onKey(e) {
  if (e.repeat) return;
  if (e.code !== "KeyG" && e.code !== "KeyK") return;
  const state = stateRef?.();
  if (!state) return;
  e.preventDefault();
  swing(state);
}

// Spawns the cross-pattern bullets. Exported for unit tests.
export function performMeleeSwing(state, opts = {}) {
  if (cooldown > 0 && !opts.ignoreCooldown) return false;
  const weaponId = getEquipped(SLOT_MELEE);
  if (!weaponId) return false;
  const weapon = getSpecies(weaponId);
  if (!weapon || weapon.entity_type !== "WeaponMelee") return false;
  const bulletId = weapon.bullet_species_id;
  if (!bulletId) return false;
  const bulletSp = getSpecies(bulletId);
  if (!bulletSp) return false;

  cooldown = weapon.cooldown_after_use > 0 ? weapon.cooldown_after_use : DEFAULT_COOLDOWN;
  const lifespan = weapon.bullet_lifespan > 0 ? weapon.bullet_lifespan : DEFAULT_LIFESPAN;
  const speed = bulletSp.base_speed > 0 ? bulletSp.base_speed : 0;
  const dps = (bulletSp.dps || 0) * (weapon.melee_dps_multiplier || 1);

  const dir = state.player.direction;
  const [vx, vy] = DIR_DELTA[dir] ?? [0, 1];

  for (const [ox, oy] of BULLET_OFFSETS) {
    const bullet = {
      id: -(nextBulletId++),
      _spawned: true,
      _vx: vx * speed,
      _vy: vy * speed,
      _lifespan: lifespan,
      _dpsOverride: dps,
      species_id: bulletId,
      is_consumable: false,
      direction: capitalize(dir),
      frame: {
        x: state.player.tileX + ox,
        y: state.player.tileY + oy,
        w: 1, h: 1,
      },
      dialogues: [],
    };
    state.world.entities.push(bullet);
  }
  playSfx(SFX_FOR_USAGE[weapon.equipment_usage_sound_effect] || "swordSlash");
  return true;
}

function swing(state) { performMeleeSwing(state); }

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
