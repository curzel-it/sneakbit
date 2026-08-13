// Player ranged attack: press F (or the on-screen knife button) to throw a
// kunai. We spawn a Bullet entity that travels in the player's facing
// direction. pickups.js leaves player-spawned bullets alone (via the
// _spawned flag) so the thrown kunai doesn't re-collect itself.
//
// Bullet/entity collision is handled in combat.js — here we only spawn
// bullets and advance them through space. The bullet is removed when it
// runs out of lifespan or leaves the zone bounds; combat.js removes
// bullets that hit walls or kill targets. Piercing bullets (the cannon)
// are the exception: they ignore lifespan and kills, so only a wall or
// the zone edge stops them.

import { getSpecies } from "./species.js";
import { getAmmo, removeAmmo } from "./inventory.js";
import { playSfx } from "./audio.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { broadcastHostEvent } from "./hostEvents.js";
import { matchesAction } from "./keyBindings.js";
import { isCoopMode, isCoopActive, localPlayerCount, COOP_KEYMAPS } from "./coopMode.js";
import { getNetRole } from "./onlineBootstrap.js";
import { isPlayerDead } from "./playerHealth.js";
import { rumble } from "./rumble.js";
import { spawnLocalFlash } from "./localEffects.js";
import { isIceActive } from "./iceMode.js";
import { ANIMATIONS_FPS } from "./constants.js";
import { playerForSlot } from "./playerSlots.js";

const KUNAI_BULLET_SPECIES_ID = 7000;
const BULLET_SPEED = 9;           // fallback: kunai base_speed
const BULLET_LIFESPAN = 1.6;      // fallback when species lifespan missing
const COOLDOWN = 0.35;            // fallback when weapon.cooldown_after_use==0
const MAX_PLAYERS = 4;
// How long the firing pose stays on screen after a shot. Mirrors Rust
// equipment/ranged.rs, where play_equipment_usage_animation holds the
// attack-row strip until the sprite completes one full loop — i.e. its
// frame count / animation FPS — rather than the (often tiny) firing
// cooldown. The AR-15's 0.005s cooldown would otherwise flash the pose
// for a single frame and look like nothing happened.
const FIRE_ANIM_FALLBACK = 0.4;   // 4-frame strip at ANIMATIONS_FPS

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
// Latest cooldown length per player, so the on-screen attack button can derive
// a 0..1 sweep (mirrors melee.js's cooldownDuration).
const cooldownDuration = new Float32Array(MAX_PLAYERS);
// Firing-pose animation, decoupled from the cooldown above (see
// FIRE_ANIM_FALLBACK). fireAnim[i] decays each tick; fireAnimDuration[i]
// holds the latest pose length so the equipment overlay can derive a 0..1
// progress, exactly like melee's swing state.
const fireAnim = new Float32Array(MAX_PLAYERS);
const fireAnimDuration = new Float32Array(MAX_PLAYERS);
let nextBulletId = 1;

// Returns 0..1 while a shot is still cooling down for the given player (1.0 =
// just fired, 0.0 = ready), or null when ready. Parallels melee.js's
// getMeleeSwingProgress; the touch HUD reads it to draw the cooldown ring.
export function getShootCooldownProgress(playerIndex = 0) {
  const i = playerIndex | 0;
  const cd = cooldown[i] ?? 0;
  const dur = cooldownDuration[i] ?? 0;
  if (cd <= 0 || dur <= 0) return null;
  return Math.max(0, Math.min(1, cd / dur));
}

// Returns 0..1 while the firing pose is still showing for the given player
// (1.0 = just fired, 0.0 = pose done), or null when idle. entities.js's
// drawEquipment reads this for the ranged slot, the way it reads
// getMeleeSwingProgress for the melee slot — flipping the weapon overlay to
// its attack-row strip while the shot animates.
export function getShootAnimProgress(playerIndex = 0) {
  const i = playerIndex | 0;
  const a = fireAnim[i] ?? 0;
  const dur = fireAnimDuration[i] ?? 0;
  if (a <= 0 || dur <= 0) return null;
  return Math.max(0, Math.min(1, a / dur));
}

// One sprite-loop's worth of seconds for the weapon's overlay strip, used as
// the firing-pose length. Falls back to a fixed window when the weapon has no
// (or a single-frame) sprite — e.g. the kunai launcher, which has no in-zone
// overlay to animate anyway.
function fireAnimDurationFor(weapon) {
  const frames = weapon?.frames | 0;
  return frames > 1 ? frames / ANIMATIONS_FPS : FIRE_ANIM_FALLBACK;
}

export function installShooting(getState) {
  stateRef = getState;
  window.addEventListener("keydown", onKey);
}

export function tickShooting(dt) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (cooldown[i] > 0) cooldown[i] = Math.max(0, cooldown[i] - dt);
    if (fireAnim[i] > 0) fireAnim[i] = Math.max(0, fireAnim[i] - dt);
  }
  const state = stateRef?.();
  if (!state || !state.zone) return;
  advanceBullets(state, dt);
}

// Exposed so the touch action button can trigger a shot.
export function tryShoot() {
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  shoot(state, state.player);
}

// Per-slot injection seam. hostGuests.dispatchActionForSlot used to
// round-trip through window.dispatchEvent(new KeyboardEvent), which (a)
// couldn't run in a Node test without a DOM stub and (b) stayed brittle
// whenever this module's bindings changed. playerSlots resolves the actor
// in the local world — the host's own avatar, a local co-op P2-P4 firing
// from their own pad, or the guest holding that seat.
export function tryShootForSlot(slot) {
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  const shooter = playerForSlot(state, slot);
  if (!shooter) return;
  shoot(state, shooter);
}

// Fire for a specific hero player object directly, without the slot→player
// resolution that gates online guest slots on a playerId.
export function tryShootForPlayer(player) {
  const state = stateRef?.();
  if (!state || !player) return;
  shoot(state, player);
}

// Guest-side local prediction: the instant the guest presses shoot, play the
// gunshot SFX and pop a brief muzzle flash one tile ahead — instead of waiting
// a full RTT for the host's authoritative bullet to echo back in a snapshot.
// The host still owns the real bullet, ammo, and damage via the forwarded
// intent. We deliberately do NOT spawn a moving projectile here (that would
// risk a visual double-bullet against the host's authoritative one); just the
// flash + sound, which is where "feels instant" comes from.
//
// SFX is local-only and never networked, so this is the only way the guest
// hears its own shot, and it can't double up. A timestamp throttle stands in
// for the host's cooldown array (the guest never runs tickShooting, so that
// array would never decay here).
let lastPredictAt = 0;
export function predictGuestShoot(player) {
  if (!player) return;
  const weaponId = resolveLoadout(player).ranged;
  const weapon = weaponId ? getSpecies(weaponId) : null;
  // Mirror resolveRangedWeapon's fallback so the flash/sound still fire with
  // the default kunai when no ranged weapon is equipped/loaded.
  const bulletId = (weapon && weapon.entity_type === "WeaponRanged" && weapon.bullet_species_id)
    ? weapon.bullet_species_id
    : KUNAI_BULLET_SPECIES_ID;
  const cd = (weapon?.cooldown_after_use > 0) ? weapon.cooldown_after_use : COOLDOWN;
  const now = Date.now();
  if (now - lastPredictAt < cd * 1000) return; // throttle to the weapon's rate
  lastPredictAt = now;
  // Drive the touch cooldown ring for the guest's own avatar — the guest never
  // runs the authoritative shoot() path, so seed the cooldown here too.
  const i = player.index | 0;
  if (i >= 0 && i < MAX_PLAYERS) {
    cooldown[i] = cd; cooldownDuration[i] = cd;
    // Arm the firing pose for the guest's own avatar too, so the predicted
    // self animates the shot without waiting on the host's snapshot.
    fireAnimDuration[i] = fireAnimDurationFor(weapon);
    fireAnim[i] = fireAnimDuration[i];
  }

  playSfx(SFX_FOR_USAGE[weapon?.equipment_usage_sound_effect] || "knifeThrown");
  const [dx, dy] = DIR_DELTA[player.direction] ?? DIR_DELTA.down;
  spawnLocalFlash({
    speciesId: bulletId,
    x: player.tileX + dx,
    y: player.tileY + dy,
    direction: player.direction,
  });
}

function onKey(e) {
  if (e.repeat) return;
  // Guests must not drive the local sim — they forward the intent over
  // the wire and let the host decide. Without this gate the local zone
  // gets a bullet and the local ammo counter decrements on every press
  // while the wire-side shot also fires (double-fire bug).
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  const shooter = pickShooter(state, e.code);
  if (!shooter) return;
  e.preventDefault();
  shoot(state, shooter);
}

function pickShooter(state, code) {
  // P1 always uses their rebindable bindings, even in co-op — so muscle
  // memory from single-player still works.
  if (matchesAction("shoot", code, 0)) return state.player;
  // P2 only exists in local co-op (spawned at boot when isCoopMode()).
  if (isCoopMode() && matchesAction("shoot", code, 1)) {
    return state.player2 || state.player;
  }
  // Local P3 / P4 (4-player co-op) live in state.players[] with no
  // playerId. Their keyboard keys (empty by default) route here once the
  // local player count covers them.
  if (localPlayerCount() >= 3 && matchesAction("shoot", code, 2)) return playerForSlot(state, 3);
  if (localPlayerCount() >= 4 && matchesAction("shoot", code, 3)) return playerForSlot(state, 4);
  // Online guests fire through hostGuests.dispatchActionForSlot, which
  // synthesises a keydown with the matching slot's COOP_KEYMAPS code.
  // Slot 2 lives in state.player2 (network guest); slots 3/4 in
  // state.players[]. Gated on a playerId so a local-coop P2 (no playerId)
  // doesn't accidentally claim the slot-2 sentinel.
  if (isCoopActive()) {
    if (code === COOP_KEYMAPS[2]?.shoot && state.player2?.playerId) {
      return state.player2;
    }
    for (const slot of [3, 4]) {
      if (code === COOP_KEYMAPS[slot]?.shoot) {
        return playerForSlot(state, slot) || state.player;
      }
    }
  }
  return null;
}

function shoot(state, shooter) {
  const idx = (shooter?.index | 0) || 0;
  if (isPlayerDead(idx)) return;
  // A hero frozen by a demands-attention NPC can't act during the cutscene.
  if (shooter?._frozen) return;
  if (cooldown[idx] > 0) return;
  const { weapon, bulletId } = resolveRangedWeapon(shooter);
  const bulletSp = getSpecies(bulletId);
  if (!bulletSp) return;
  if (getAmmo(bulletId, idx) <= 0) { playSfx("noAmmo"); rumble(idx + 1, "noAmmo"); return; }
  if (!removeAmmo(bulletId, 1, idx)) return;
  // Per-player inventory in online co-op: tell the shooter's client about
  // their new authoritative count so their AmmoHud ticks down. We send
  // absolute counts (rather than -1 deltas) so a missed/reordered frame
  // can't desync the HUD. No-op for the host's own shots (broadcastHostEvent
  // doesn't echo to self) and for local-only play.
  if (shooter?.playerId) {
    broadcastHostEvent("ammoSet", {
      playerId: shooter.playerId,
      items: [{ speciesId: bulletId, count: getAmmo(bulletId, idx) }],
    });
  }
  cooldown[idx] = (weapon?.cooldown_after_use > 0) ? weapon.cooldown_after_use : COOLDOWN;
  cooldownDuration[idx] = cooldown[idx];
  // Arm the firing pose. Reset on every shot so rapid fire (the AR-15's
  // 0.005s cooldown) keeps the overlay on its attack-row strip; once firing
  // stops it plays out the remaining loop, like Rust's sprite.reset() +
  // play_equipment_usage_animation.
  fireAnimDuration[idx] = fireAnimDurationFor(weapon);
  fireAnim[idx] = fireAnimDuration[idx];

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
    // Ice buff: an icy bullet freezes the monsters it hits and renders a frost
    // aura (freeze.js / iceMode.js). Tagged at spawn so it stays icy for its
    // whole flight even if the buff lapses while it's in the air.
    _icy: isIceActive(shooter) || undefined,
    // Piercing round (the cannonball): it never stops on a target and never
    // times out — advanceBullets skips the lifespan cull below and combat.js
    // keeps it alive through every kill. Only a wall or the zone edge ends it.
    // Tagged at spawn, like _icy, so the flight is decided once.
    _piercing: bulletSp.supports_bullet_piercing || undefined,
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
  state.zone.entities.push(bullet);
  playSfx(SFX_FOR_USAGE[weapon?.equipment_usage_sound_effect] || "knifeThrown");
}

// Picks the equipped ranged weapon's bullet species, falling back to the
// kunai bullet so the game keeps working when no species data is loaded
// (tests) or when equipment storage is empty in an unusual way. Takes the
// shooter object (not just the index) so online co-op resolves through
// sessionLoadouts by playerId — the host needs each guest's actual gear,
// not the shared index-0 fold.
function resolveRangedWeapon(shooter) {
  const weaponId = resolveLoadout(shooter).ranged;
  const weapon = weaponId ? getSpecies(weaponId) : null;
  if (weapon && weapon.entity_type === "WeaponRanged" && weapon.bullet_species_id) {
    return { weapon, bulletId: weapon.bullet_species_id };
  }
  return { weapon: null, bulletId: KUNAI_BULLET_SPECIES_ID };
}

function advanceBullets(state, dt) {
  const ents = state.zone.entities;
  const zone = state.zone;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    if (!e._spawned) continue;
    const f = e.frame;
    f.x += e._vx * dt;
    f.y += e._vy * dt;
    e._lifespan -= dt;
    if (
      (e._lifespan <= 0 && !e._piercing) ||
      f.x < -1 || f.y < -1 ||
      f.x > zone.cols || f.y > zone.rows
    ) {
      ents.splice(i, 1);
    }
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
