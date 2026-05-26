// Player ranged attack: press F (or the on-screen knife button) to throw a
// kunai. We spawn a Bullet entity that travels in the player's facing
// direction at constant speed; pickups.js leaves player-spawned bullets
// alone (via the _spawned flag) so the thrown kunai doesn't immediately
// re-collect itself.
//
// We don't simulate true collision against walls/entities yet — bullets
// just fade out when they leave the world bounds or after a max range.

import { getSpecies } from "./species.js";
import { getAmmo, removeAmmo } from "./inventory.js";
import { playSfx } from "./audio.js";

// The kunai species id matches the original (game_core/known_species).
const KUNAI_SPECIES_ID = 7000;
const BULLET_SPEED = 14;          // tiles/sec
const BULLET_MAX_TRAVEL = 12;     // tiles before despawn
const COOLDOWN = 0.35;            // seconds between throws

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

let stateRef = null;
let cooldown = 0;
let nextBulletId = 1;

export function installShooting(getState) {
  stateRef = getState;
  window.addEventListener("keydown", onKey);
}

export function tickShooting(dt) {
  if (cooldown > 0) cooldown = Math.max(0, cooldown - dt);
  const state = stateRef?.();
  if (!state) return;
  advanceBullets(state, dt);
}

// Exposed so the touch action button can trigger a shot.
export function tryShoot() {
  const state = stateRef?.();
  if (!state) return;
  shoot(state);
}

function onKey(e) {
  if (e.repeat) return;
  if (e.code !== "KeyF" && e.code !== "KeyJ") return;
  const state = stateRef?.();
  if (!state) return;
  e.preventDefault();
  shoot(state);
}

function shoot(state) {
  if (cooldown > 0) return;
  const sp = getSpecies(KUNAI_SPECIES_ID);
  if (!sp) return;
  if (getAmmo(KUNAI_SPECIES_ID) <= 0) {
    playSfx("noAmmo");
    return;
  }
  if (!removeAmmo(KUNAI_SPECIES_ID, 1)) return;
  cooldown = COOLDOWN;

  const dir = state.player.direction;
  const [dx, dy] = DIR_DELTA[dir] ?? DIR_DELTA.down;
  const bullet = {
    id: -(nextBulletId++),
    _spawned: true,
    _vx: dx * BULLET_SPEED,
    _vy: dy * BULLET_SPEED,
    _travelled: 0,
    species_id: KUNAI_SPECIES_ID,
    is_consumable: false,
    direction: capitalize(dir),
    frame: { x: state.player.tileX, y: state.player.tileY, w: 1, h: 1 },
    dialogues: [],
  };
  state.world.entities.push(bullet);
  playSfx("knifeThrown");
}

function advanceBullets(state, dt) {
  const ents = state.world.entities;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    if (!e._spawned) continue;
    const f = e.frame;
    f.x += e._vx * dt;
    f.y += e._vy * dt;
    e._travelled += Math.hypot(e._vx, e._vy) * dt;
    if (
      e._travelled > BULLET_MAX_TRAVEL ||
      f.x < -1 || f.y < -1 ||
      f.x > state.world.cols || f.y > state.world.rows
    ) {
      ents.splice(i, 1);
    }
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : "Down"; }
