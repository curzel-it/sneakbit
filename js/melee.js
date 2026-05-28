// Player melee attack: press G (or the on-screen melee button) to swing
// the equipped melee weapon. Mirrors Rust equipment/melee.rs: spawns five
// short-lived bullet entities in a cross pattern around the hero (center
// + four cardinals). Each bullet deals bullet_species.dps *
// weapon.melee_dps_multiplier, applied via combat.js's normal bullet
// resolution path.

import { getSpecies } from "./species.js?v=20260528";
import { resolveLoadout } from "./sessionLoadouts.js?v=20260528";
import { playSfx } from "./audio.js?v=20260528";
import { matchesAction } from "./keyBindings.js?v=20260528";
import { isCoopMode, isCoopActive, COOP_KEYMAPS } from "./coopMode.js?v=20260528";
import { getNetRole } from "./onlineBootstrap.js?v=20260528";

const DEFAULT_COOLDOWN = 0.35;
const DEFAULT_LIFESPAN = 0.4;
const MAX_PLAYERS = 4;

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
// Per-player cooldown / swing-animation state. cooldown[i] decays each
// tick; cooldownDuration[i] holds the latest swing length so the
// equipment overlay can derive a 0..1 progress.
const cooldown = new Float32Array(MAX_PLAYERS);
const cooldownDuration = new Float32Array(MAX_PLAYERS);
let nextBulletId = 1;

// Returns 0..1 if a melee swing is mid-animation for the given player
// (where 1.0 = just started, 0.0 = finished), or null otherwise.
// entities.js::drawEquipment reads this to flip the equipment sprite to
// its usage-row strip while the swing plays out.
export function getMeleeSwingProgress(playerIndex = 0) {
  const i = playerIndex | 0;
  const cd = cooldown[i] ?? 0;
  const dur = cooldownDuration[i] ?? 0;
  if (cd <= 0 || dur <= 0) return null;
  return Math.max(0, Math.min(1, cd / dur));
}

export function installMelee(getState) {
  stateRef = getState;
  window.addEventListener("keydown", onKey);
}

export function tickMelee(dt) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (cooldown[i] > 0) cooldown[i] = Math.max(0, cooldown[i] - dt);
  }
}

// Touch button entry point — parity with shooting.tryShoot.
export function tryMelee() {
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  swing(state, state.player);
}

// Network injection seam — see shooting.tryShootForSlot for the
// motivation. dispatchActionForSlot calls this directly instead of
// synthesising a KeyboardEvent.
export function tryMeleeForSlot(slot) {
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  const swinger = playerForSlotInState(state, slot);
  if (!swinger) return;
  swing(state, swinger);
}

function playerForSlotInState(state, slot) {
  if (slot === 1) return state.player || null;
  if (slot === 2) return (state.player2 && state.player2.playerId) ? state.player2 : null;
  if (!Array.isArray(state.players)) return null;
  const s = state.players.find((e) => e.slot === slot);
  return s ? s.player : null;
}

function onKey(e) {
  if (e.repeat) return;
  // Guests forward the melee intent over the wire — local sim is the
  // host's, so swinging into the dead local zone would just spawn an
  // orphan bullet entity and decrement nothing meaningful.
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  const swinger = pickSwinger(state, e.code);
  if (!swinger) return;
  e.preventDefault();
  swing(state, swinger);
}

function pickSwinger(state, code) {
  if (matchesAction("melee", code, 0)) return state.player;
  if (isCoopMode() && matchesAction("melee", code, 1)) {
    return state.player2 || state.player;
  }
  if (isCoopActive()) {
    if (code === COOP_KEYMAPS[2]?.melee && state.player2?.playerId) {
      return state.player2;
    }
    for (const slot of [3, 4]) {
      if (code === COOP_KEYMAPS[slot]?.melee) {
        return playerForSlot(state, slot) || state.player;
      }
    }
  }
  return null;
}

function playerForSlot(state, slot) {
  if (!Array.isArray(state.players)) return null;
  const s = state.players.find((e) => e.slot === slot);
  return s ? s.player : null;
}

// Spawns the cross-pattern bullets. Exported for unit tests.
// `opts.swinger` defaults to state.player so existing tests keep working.
export function performMeleeSwing(state, opts = {}) {
  const swinger = opts.swinger || state.player;
  const idx = (swinger?.index | 0) || 0;
  if (cooldown[idx] > 0 && !opts.ignoreCooldown) return false;
  const weaponId = resolveLoadout(swinger).melee;
  if (!weaponId) return false;
  const weapon = getSpecies(weaponId);
  if (!weapon || weapon.entity_type !== "WeaponMelee") return false;
  const bulletId = weapon.bullet_species_id;
  if (!bulletId) return false;
  const bulletSp = getSpecies(bulletId);
  if (!bulletSp) return false;

  const cd = weapon.cooldown_after_use > 0 ? weapon.cooldown_after_use : DEFAULT_COOLDOWN;
  cooldown[idx] = cd;
  cooldownDuration[idx] = cd;
  const lifespan = weapon.bullet_lifespan > 0 ? weapon.bullet_lifespan : DEFAULT_LIFESPAN;
  const speed = bulletSp.base_speed > 0 ? bulletSp.base_speed : 0;
  const dps = (bulletSp.dps || 0) * (weapon.melee_dps_multiplier || 1);

  const dir = swinger.direction;
  const [vx, vy] = DIR_DELTA[dir] ?? [0, 1];

  for (const [ox, oy] of BULLET_OFFSETS) {
    const bullet = {
      id: -(nextBulletId++),
      _spawned: true,
      _invisible: true,
      _vx: vx * speed,
      _vy: vy * speed,
      _lifespan: lifespan,
      _dpsOverride: dps,
      _playerIndex: idx,
      species_id: bulletId,
      is_consumable: false,
      direction: capitalize(dir),
      frame: {
        x: swinger.tileX + ox,
        y: swinger.tileY + oy,
        w: 1, h: 1,
      },
      dialogues: [],
    };
    state.zone.entities.push(bullet);
  }
  playSfx(SFX_FOR_USAGE[weapon.equipment_usage_sound_effect] || "swordSlash");
  return true;
}

function swing(state, swinger) {
  performMeleeSwing(state, { swinger: swinger || state.player });
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
