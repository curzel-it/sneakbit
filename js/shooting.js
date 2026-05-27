// Player ranged attack: press F (or the on-screen knife button) to throw a
// kunai. We spawn a Bullet entity that travels in the player's facing
// direction. pickups.js leaves player-spawned bullets alone (via the
// _spawned flag) so the thrown kunai doesn't re-collect itself.
//
// Bullet/entity collision is handled in combat.js — here we only spawn
// bullets and advance them through space. The bullet is removed when it
// runs out of lifespan or leaves the zone bounds; combat.js removes
// bullets that hit walls or kill targets.

import { getSpecies } from "./species.js?v=20260527b";
import { getAmmo, removeAmmo } from "./inventory.js?v=20260527b";
import { playSfx } from "./audio.js?v=20260527b";
import { getEquipped, SLOT_RANGED } from "./equipment.js?v=20260527b";
import { matchesAction } from "./keyBindings.js?v=20260527b";
import { isCoopMode, isCoopActive, COOP_KEYMAPS } from "./coopMode.js?v=20260527b";
import { getNetRole } from "./onlineBootstrap.js?v=20260527b";

const KUNAI_BULLET_SPECIES_ID = 7000;
const BULLET_SPEED = 9;           // fallback: kunai base_speed
const BULLET_LIFESPAN = 1.6;      // fallback when species lifespan missing
const COOLDOWN = 0.35;            // fallback when weapon.cooldown_after_use==0
const MAX_PLAYERS = 4;

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
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  shoot(state, state.player);
}

// Host-side network injection seam. hostGuests.dispatchActionForSlot
// used to round-trip through window.dispatchEvent(new KeyboardEvent),
// which (a) couldn't run in a Node test without a DOM stub and (b)
// stayed brittle whenever this module's bindings changed. The slot
// directly resolves the actor in the host's local world:
//   1 → state.player           (the host themselves; only fires here if
//                                explicitly invoked, the keyboard handler
//                                already covers normal play)
//   2 → state.player2          (online guest slot 2, gated on playerId
//                                so a local-coop P2 sentinel doesn't
//                                accidentally claim the slot)
//   3, 4 → state.players[]     (online guest slots 3/4)
export function tryShootForSlot(slot) {
  if (getNetRole() === "guest") return;
  const state = stateRef?.();
  if (!state) return;
  const shooter = playerForSlotInState(state, slot);
  if (!shooter) return;
  shoot(state, shooter);
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

function playerForSlot(state, slot) {
  if (!Array.isArray(state.players)) return null;
  const s = state.players.find((e) => e.slot === slot);
  return s ? s.player : null;
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
  state.zone.entities.push(bullet);
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
      e._lifespan <= 0 ||
      f.x < -1 || f.y < -1 ||
      f.x > zone.cols || f.y > zone.rows
    ) {
      ents.splice(i, 1);
    }
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
