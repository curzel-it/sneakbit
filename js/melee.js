// Player melee attack: press G (or the on-screen melee button) to swing
// the equipped melee weapon. Mirrors Rust equipment/melee.rs: spawns five
// short-lived bullet entities in a cross pattern around the hero (center
// + four cardinals). Each bullet deals bullet_species.dps *
// weapon.melee_dps_multiplier, applied via combat.js's normal bullet
// resolution path.

import { getSpecies } from "./species.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { playSfx } from "./audio.js";
import { matchesAction } from "./keyBindings.js";
import { isCoopMode, isCoopActive, localPlayerCount, COOP_KEYMAPS } from "./coopMode.js";
import { getNetRole } from "./onlineBootstrap.js";
import { isPlayerDead } from "./playerHealth.js";
import { pvpSlotCanAct } from "./pvpMatch.js";
import { isGiant } from "./giantMode.js";
import { isIceActive } from "./iceMode.js";

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

// Giant melee: while transformed (giantMode) the hero fights bare-handed.
// The weapon overlay is hidden at giant scale (entities.drawGiant), so a
// sword would be invisible anyway — and a towering giant punching with its
// fists is the point. Fists ignore the equipped weapon entirely: they hit
// harder than a default swing and reach two tiles out across the giant's
// wider 3-tile footprint. They reuse the (invisible, dps-overridden) sword
// bullet species purely as the entity carrier, so no new species data is
// needed — combat.js reads `_dpsOverride`, not the species dps.
const GIANT_FIST_BULLET_ID = 1166;
const GIANT_FIST_DPS = 700;
const GIANT_FIST_COOLDOWN = 0.5;
const GIANT_FIST_LIFESPAN = 0.4;
const GIANT_FIST_SPEED = 2.0;
const GIANT_FIST_SFX = "smallExplosion"; // a heavy thud befitting a giant's punch
const GIANT_BULLET_OFFSETS = [
  [ 0,  0],
  [ 0, -1], [ 0,  1], [ 1,  0], [-1,  0], // the giant's own footprint + adjacent
  [ 0, -2], [ 0,  2], [ 2,  0], [-2,  0], // long-armed reach, two tiles out
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

// Raw cooldown state for a player index. The host ships this in snapshots
// (snapshotBroadcaster.serializePlayer) so guests can drive the swing
// animation for the host + other guests, whose local sim never runs.
export function getMeleeCooldown(playerIndex = 0) {
  const i = playerIndex | 0;
  return { cd: cooldown[i] ?? 0, dur: cooldownDuration[i] ?? 0 };
}

// Cosmetic-only swing trigger. Unlike performMeleeSwing it spawns no
// bullets and plays no SFX — the host owns the authoritative hit + sound.
// Used by the guest paths: local prediction for the guest's own avatar
// (predictGuestSwing) and snapshot ingestion for everyone else
// (mirrorWorld). Drives the equipment overlay via getMeleeSwingProgress.
export function setSwingAnimation(playerIndex, remaining, duration) {
  const i = playerIndex | 0;
  if (i < 0 || i >= MAX_PLAYERS) return;
  const dur = duration > 0 ? duration : DEFAULT_COOLDOWN;
  const cd = remaining > 0 ? Math.min(remaining, dur) : dur;
  cooldown[i] = cd;
  cooldownDuration[i] = dur;
}

// Guest-side local prediction: start the swing animation AND play the swing
// SFX for the guest's own avatar the instant they press melee, instead of
// waiting a full RTT for the host's snapshot to echo it back. The host still
// owns the authoritative swing — bullets and damage — via the forwarded
// intent; SFX is local-only (never networked) so playing it here is the only
// way the guest ever hears its own swing, and it can't double up.
export function predictGuestSwing(player) {
  if (!player) return;
  // A giant guest swings bare-handed — no weapon to consult; play the punch
  // SFX so they hear it without waiting a full RTT for the host's echo.
  if (isGiant(player)) {
    setSwingAnimation(player.index | 0, GIANT_FIST_COOLDOWN, GIANT_FIST_COOLDOWN);
    playSfx(GIANT_FIST_SFX);
    return;
  }
  const weaponId = resolveLoadout(player).melee;
  if (!weaponId) return;
  const weapon = getSpecies(weaponId);
  if (!weapon || weapon.entity_type !== "WeaponMelee") return;
  const cd = weapon.cooldown_after_use > 0 ? weapon.cooldown_after_use : DEFAULT_COOLDOWN;
  setSwingAnimation(player.index | 0, cd, cd);
  playSfx(SFX_FOR_USAGE[weapon.equipment_usage_sound_effect] || "swordSlash");
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
  // Local P3 / P4 keyboard (empty by default) once the count covers them.
  if (localPlayerCount() >= 3 && matchesAction("melee", code, 2)) return playerForSlot(state, 3);
  if (localPlayerCount() >= 4 && matchesAction("melee", code, 3)) return playerForSlot(state, 4);
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
  if (isPlayerDead(idx)) return false;
  // PvP: only the active player's turn may swing (no-op outside PvP).
  if (!pvpSlotCanAct(idx + 1)) return false;
  if (cooldown[idx] > 0 && !opts.ignoreCooldown) return false;

  // While giant, the equipped melee weapon is bypassed for bare-handed fists.
  const profile = isGiant(swinger) ? giantFistProfile() : weaponProfile(swinger);
  if (!profile) return false;
  const { bulletId, dps, cd, lifespan, speed, sfx, offsets } = profile;

  cooldown[idx] = cd;
  cooldownDuration[idx] = cd;

  const dir = swinger.direction;
  const [vx, vy] = DIR_DELTA[dir] ?? [0, 1];
  // Ice buff: tag the swing's cross-bullets so they freeze the monsters they
  // hit and render a frost aura (freeze.js / iceMode.js). Resolved once per
  // swing so every bullet in the cross shares the swinger's buff state.
  const icy = isIceActive(swinger) || undefined;

  for (const [ox, oy] of offsets) {
    const bullet = {
      id: -(nextBulletId++),
      _spawned: true,
      _invisible: true,
      _vx: vx * speed,
      _vy: vy * speed,
      _lifespan: lifespan,
      _dpsOverride: dps,
      _melee: true,
      _playerIndex: idx,
      _icy: icy,
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
  playSfx(sfx);
  return true;
}

// Swing parameters for the equipped melee weapon, or null if none is equipped
// / it isn't a valid melee weapon. Damage = bullet.dps * melee_dps_multiplier.
function weaponProfile(swinger) {
  const weaponId = resolveLoadout(swinger).melee;
  if (!weaponId) return null;
  const weapon = getSpecies(weaponId);
  if (!weapon || weapon.entity_type !== "WeaponMelee") return null;
  const bulletId = weapon.bullet_species_id;
  if (!bulletId) return null;
  const bulletSp = getSpecies(bulletId);
  if (!bulletSp) return null;
  return {
    bulletId,
    dps: (bulletSp.dps || 0) * (weapon.melee_dps_multiplier || 1),
    cd: weapon.cooldown_after_use > 0 ? weapon.cooldown_after_use : DEFAULT_COOLDOWN,
    lifespan: weapon.bullet_lifespan > 0 ? weapon.bullet_lifespan : DEFAULT_LIFESPAN,
    speed: bulletSp.base_speed > 0 ? bulletSp.base_speed : 0,
    sfx: SFX_FOR_USAGE[weapon.equipment_usage_sound_effect] || "swordSlash",
    offsets: BULLET_OFFSETS,
  };
}

// Swing parameters for a giant's bare-handed punch — no weapon required.
// Returns null only if the carrier bullet species isn't loaded.
function giantFistProfile() {
  if (!getSpecies(GIANT_FIST_BULLET_ID)) return null;
  return {
    bulletId: GIANT_FIST_BULLET_ID,
    dps: GIANT_FIST_DPS,
    cd: GIANT_FIST_COOLDOWN,
    lifespan: GIANT_FIST_LIFESPAN,
    speed: GIANT_FIST_SPEED,
    sfx: GIANT_FIST_SFX,
    offsets: GIANT_BULLET_OFFSETS,
  };
}

function swing(state, swinger) {
  // A hero frozen by a demands-attention NPC can't act during the cutscene.
  if ((swinger || state.player)?._frozen) return;
  performMeleeSwing(state, { swinger: swinger || state.player });
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
