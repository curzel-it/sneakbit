// Knockback Aura — a passive, last-ditch defensive skill.
//
// While the player owns the skill (skills.js "aura"), this runs every host
// frame and watches for the danger condition: the player is below 10% HP and
// a melee enemy is within range. When it fires it:
//   * opens a short full-immunity window (playerHealth.setPlayerHardImmunity),
//   * plays an activation animation overlaid on the hero (drawn by entities.js
//     from the weapons spritesheet via AURA_SPRITE),
//   * knocks every in-range enemy back one tile (mobs.knockbackEntity), and
//   * instantly strips 25% of each enemy's base HP (they can die from it).
// Then it goes on a 30-second cooldown.
//
// This is host-authoritative: damage, knockback motion, deaths and HP all
// replicate to co-op guests through the existing entity/HP snapshot path. The
// only thing networked explicitly is the per-player animation timer — shipped
// by snapshotBroadcaster (aura) and applied onto the render-player object by
// mirrorWorld, which getAuraAnimProgress(player) reads on the guest.
//
// Designed to level up later: the constants below (radius, damage fraction)
// are the knobs a future "expand range / effect" upgrade would scale.

import { ANIMATIONS_FPS, SPRITE_SHEET_WEAPONS } from "./constants.js";
import { getSpecies } from "./species.js";
import { isCreativeMode } from "./creativeMode.js";
import { hasKnockbackAura } from "./skills.js";
import {
  getPlayerHp, getPlayerMaxHp, isPlayerDead, setPlayerHardImmunity,
} from "./playerHealth.js";
import { knockbackEntity } from "./mobs.js";
import { startDeathAnimation } from "./deathAnimation.js";
import { maybeDropLoot } from "./lootDrops.js";
import { playSfx } from "./audio.js";

const MAX_PLAYERS = 4;

// --- Tunables (future leveling scales these) ------------------------------
export const AURA_RADIUS = 1;        // tiles — enemies this close are affected
const AURA_HP_THRESHOLD = 0.10;      // fires only under 10% HP
const AURA_DAMAGE_FRAC = 0.25;       // 25% of each enemy's base HP, instant
const AURA_COOLDOWN = 30;            // seconds between activations
const AURA_KNOCKBACK_TILES = 3;      // how far enemies are pushed

// Activation sprite on the weapons sheet (SPRITE_SHEET_WEAPONS). `texX/texY`
// are tile coords; `frames` are laid out horizontally; `w/h` is the sprite
// size in tiles. Same 4-frame / 4×4 layout as the equipable weapons, in the
// x=97 slot (entities.drawAuraEffect reads it).
export const AURA_SPRITE = { texX: 97, texY: 1, frames: 4, w: 4, h: 4 };

// Animation length derived from the frame count, with a floor so a 1-frame
// placeholder still gives a visible immunity beat. Exported because the guest
// (mirrorWorld) converts the networked remaining-time back into 0..1 progress.
export const AURA_ANIM_DURATION = Math.max(AURA_SPRITE.frames / ANIMATIONS_FPS, 0.6);

// Per-player state, indexed by player.index (host-side only).
const cooldowns = new Float32Array(MAX_PLAYERS);
const animRemaining = new Float32Array(MAX_PLAYERS);

// Host tick: decay timers, then check + fire the aura for each live player.
// `players` is the same list combat/mobs run on (single object or array).
export function tickKnockbackAura(zone, players, dt) {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (cooldowns[i] > 0) cooldowns[i] = Math.max(0, cooldowns[i] - dt);
    if (animRemaining[i] > 0) animRemaining[i] = Math.max(0, animRemaining[i] - dt);
  }
  if (!zone?.entities) return;
  // Creative mode freezes monsters and never damages the hero, so there's
  // nothing to react to — mirror combat/mobs short-circuiting there.
  if (isCreativeMode()) return;
  if (!hasKnockbackAura()) return;

  const list = Array.isArray(players) ? players : (players ? [players] : []);
  for (const p of list) {
    if (!p) continue;
    const idx = p.index | 0;
    if (idx < 0 || idx >= MAX_PLAYERS) continue;
    if (cooldowns[idx] > 0) continue;
    if (isPlayerDead(idx)) continue;
    const max = getPlayerMaxHp(idx) || 1;
    if (getPlayerHp(idx) > max * AURA_HP_THRESHOLD) continue;
    const targets = enemiesInRange(zone, p);
    if (targets.length === 0) continue;
    activate(zone, p, idx, targets);
  }
}

function activate(zone, player, idx, targets) {
  cooldowns[idx] = AURA_COOLDOWN;
  animRemaining[idx] = AURA_ANIM_DURATION;
  setPlayerHardImmunity(AURA_ANIM_DURATION, idx);
  playSfx("smallExplosion");

  const px = player.x + 0.5;
  const py = player.y + 0.5;
  for (const e of targets) {
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    const base = sp.hp ?? 100;
    e._hp = (e._hp ?? base) - base * AURA_DAMAGE_FRAC;
    if (e._hp <= 0) {
      playSfx("deathMonster");
      startDeathAnimation(e);
      maybeDropLoot(zone, e, idx);
    } else {
      knockbackEntity(zone, e, px, py, AURA_KNOCKBACK_TILES);
    }
  }
}

// Live, non-dying CloseCombatMonsters whose feet-tile centre is within
// AURA_RADIUS of the player's tile centre. Same metric as combat.withinMeleeRange.
function enemiesInRange(zone, player) {
  const out = [];
  const px = player.x + 0.5;
  const py = player.y + 0.5;
  const r2 = AURA_RADIUS * AURA_RADIUS;
  const list = zone.visibleEntities ?? zone.entities;
  for (const e of list) {
    if (e._spawned || e._dying) continue;
    const sp = getSpecies(e.species_id);
    if (!sp || sp.entity_type !== "CloseCombatMonster") continue;
    const f = e.frame;
    if (!f) continue;
    const feetH = sp.height || f.h || 1;
    const cx = f.x + (f.w || 1) * 0.5;
    const cy = f.y + (feetH - 0.5);
    const dx = cx - px;
    const dy = cy - py;
    if (dx * dx + dy * dy <= r2) out.push(e);
  }
  return out;
}

// Animation remaining (seconds) for the broadcaster to ship to guests.
export function getAuraAnimRemaining(idx) {
  const i = idx | 0;
  return (i >= 0 && i < MAX_PLAYERS) ? animRemaining[i] : 0;
}

// Render getter, 1.0 at start → 0.0 at end, or null when idle. A networked
// render player (mirrorWorld) carries `auraAnim` (already 0..1); host-local
// players derive it from animRemaining by index.
export function getAuraAnimProgress(player) {
  if (player && player.auraAnim != null) {
    return player.auraAnim > 0 ? player.auraAnim : null;
  }
  const i = (player?.index | 0);
  if (i < 0 || i >= MAX_PLAYERS) return null;
  const rem = animRemaining[i];
  return rem > 0 ? Math.max(0, Math.min(1, rem / AURA_ANIM_DURATION)) : null;
}

// Clear timers (respawn / zone change). No index → clear everyone.
export function resetKnockbackAura(idx) {
  if (idx == null) {
    cooldowns.fill(0);
    animRemaining.fill(0);
    return;
  }
  const i = idx | 0;
  if (i >= 0 && i < MAX_PLAYERS) { cooldowns[i] = 0; animRemaining[i] = 0; }
}
