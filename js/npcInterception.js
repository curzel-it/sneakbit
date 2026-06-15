// "Demands attention" NPCs — the exclamation mark plus a Pokémon-trainer
// interception.
//
// An NPC with `demands_attention` shows an exclamation mark over its head
// (rendered by entities.js as sprite row 8, the row past the 8 directional
// rows — mirrors the Rust core's update_sprite_for_current_state) and watches
// the four cardinal directions. When the hero steps into a clear line of sight
// (up to SIGHT_RANGE tiles), the hero freezes, the NPC walks over, and its
// dialogue fires — like an enemy trainer spotting you on the overworld.
//
// One-time: once the encounter happens the mark clears and the NPC won't
// re-intercept. That's persisted with the same key the Rust core used
// (`npc_interactions.<id>`), so it survives zone reloads.
//
// Scope: only locally-driven players are intercepted (offline solo, local
// co-op, and a host's own avatar). A remote guest owns its own movement
// (docs/multiplayer.md) so the host can't freeze it; the "!" still
// renders for everyone. Creative / PvP / Tower-Defense are skipped.

import { isWalkable } from "./zone.js";
import { shouldBeVisible } from "./entityVisibility.js";
import { haltPlayer } from "./player.js";
import { findPathToNearest } from "./pathfinding.js";
import { getValue, setValue } from "./storage.js";
import { openDialogueWithEntity } from "./interact.js";
import { isCreativeMode } from "./creativeMode.js";
import { isPvp } from "./gameMode.js";
import { isDialogueOpen } from "./dialogue.js";
import { isShopOpen } from "./shop.js";
import { isPlayerDead } from "./playerHealth.js";
import { isDying } from "./deathAnimation.js";
import { isVanishing } from "./vanishEffect.js";

const SIGHT_RANGE = 5;       // clear tiles an NPC can spot the hero across
const APPROACH_SPEED = 4;    // tiles/sec the NPC walks toward the hero

const DIRS = [
  { dir: "up",    dx: 0,  dy: -1 },
  { dir: "down",  dx: 0,  dy: 1 },
  { dir: "left",  dx: -1, dy: 0 },
  { dir: "right", dx: 1,  dy: 0 },
];

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// Count of interception cutscenes currently running (spotted → walking →
// dialogue open). The freeze itself is per-player; this is just a cheap
// "is a cutscene in progress" flag for any system that wants to know.
let activeCount = 0;
export function isInterceptionActive() { return activeCount > 0; }

// The mark is armed iff the entity asks for attention AND the player hasn't
// already had the encounter (persisted, survives zone reloads). Single source
// of truth shared by the renderer (entities.js) and the tick below.
export function isDemandingAttention(e) {
  return !!(e && e.demands_attention) && getValue(`npc_interactions.${e.id}`) == null;
}

// Pure ray scan: from the NPC foot tile, look up to `range` clear tiles along
// each cardinal direction and return { player, dir, dx, dy } for the first
// player found, or null. A non-walkable tile stops that ray (corridor line of
// sight, the same walkability pathfinding uses). Exported for unit tests.
export function spotPlayerFrom(zone, footX, footY, players, range = SIGHT_RANGE) {
  for (const { dir, dx, dy } of DIRS) {
    for (let step = 1; step <= range; step++) {
      const tx = footX + dx * step;
      const ty = footY + dy * step;
      const player = players.find((p) => p.tileX === tx && p.tileY === ty);
      if (player) return { player, dir, dx, dy };
      if (!isWalkable(zone, tx, ty)) break;
    }
  }
  return null;
}

export function tickNpcInterception(state, dt) {
  const zone = state?.zone;
  if (!zone || !Array.isArray(zone.entities)) return;

  // Always advance an in-flight approach so a started cutscene completes, but
  // only ARM new ones during live, non-modal play.
  const canArm = !isCreativeMode() && !isPvp()
    && !isDialogueOpen() && !isShopOpen();
  const players = canArm ? localTargets(state) : null;

  for (const e of zone.entities) {
    if (e._approach) { tickApproach(state, e, dt); continue; }
    if (!players || players.length === 0) continue;
    if (!e.frame || isDying(e) || isVanishing(e) || e._walkAway) continue;
    if (!isDemandingAttention(e)) continue;
    // Respect the same story gate the renderer uses: an NPC the player can't
    // see (its display_conditions keep it hidden until some flag is set) must
    // not walk over out of order — e.g. the wizard who only appears after you
    // meet punk. Mirrors entities.js::collect's visibility check.
    if (!e._spawned && !shouldBeVisible(e)) continue;
    if (!(e.dialogues || []).length) continue;
    const footX = e.frame.x | 0;
    const footY = (e.frame.y + (e.frame.h || 1) - 1) | 0;
    const hit = spotPlayerFrom(zone, footX, footY, players);
    if (hit) beginInterception(zone, e, hit, footX, footY);
  }
}

// Local, alive, not-already-frozen players. Remote guest avatars (playerId
// set) are excluded — the host can't freeze a guest's authoritative movement.
function localTargets(state) {
  const out = [];
  const add = (p) => {
    if (!p || p.playerId || p._frozen) return;
    if (isPlayerDead(p.index | 0)) return;
    out.push(p);
  };
  add(state.player);
  add(state.player2);
  if (Array.isArray(state.players)) for (const s of state.players) add(s.player);
  return out;
}

function beginInterception(zone, e, hit, footX, footY) {
  const { player, dx, dy } = hit;
  player._frozen = true;
  // Halt the hero exactly on the line-of-sight tile. Holding a movement key
  // chains the next step at the same snap it reached this tile, so without
  // this it would coast one tile past before the freeze took hold.
  haltPlayer(player);
  // Turn the hero to face the approaching NPC (hit.dir points NPC → player, so
  // the NPC is the other way). The frozen hero keeps this facing for the walk.
  player.direction = OPPOSITE[hit.dir] ?? player.direction;
  activeCount++;
  // Drop the exclamation-mark state the instant the NPC starts moving so the
  // renderer plays the directional walk animation instead of the row-8 "!".
  // The one-time disarm is persisted on dialogue close (finish, below); an
  // aborted approach restores it (abortApproach).
  e.demands_attention = false;
  // Walk to the tile one step before the player (along the spotting axis), then
  // face the player. If we're already adjacent there's no path to walk.
  const stopX = player.tileX - dx;
  const stopY = player.tileY - dy;
  const path = (footX === stopX && footY === stopY)
    ? []
    : (findPathToNearest(zone, footX, footY, [{ x: stopX, y: stopY }]) || []);
  e._approach = {
    path,
    idx: 0,
    footH: e.frame.h || 1,
    player,
    faceDir: hit.dir,    // the player sits in this direction from the stop tile
  };
}

// Slides the NPC frame toward the next path tile at APPROACH_SPEED, snapping on
// arrival — same mechanics as afterDialogue.js::tickWalkAway. When the path is
// exhausted the NPC faces the player and the dialogue fires once.
function tickApproach(state, e, dt) {
  const a = e._approach;
  if (!e.frame || !a.player) { abortApproach(e); return; }

  if (a.idx < a.path.length) {
    const tile = a.path[a.idx];
    const tx = tile.x;
    const ty = tile.y - (a.footH - 1);     // top-left anchor for this foot tile
    const ddx = tx - e.frame.x;
    const ddy = ty - e.frame.y;
    const dist = Math.hypot(ddx, ddy);
    e.direction = directionFor(ddx, ddy);
    e.moving = true;
    const stepLen = APPROACH_SPEED * dt;
    if (dist <= stepLen || dist === 0) {
      e.frame.x = tx;
      e.frame.y = ty;
      a.idx++;
    } else {
      e.frame.x += (ddx / dist) * stepLen;
      e.frame.y += (ddy / dist) * stepLen;
    }
    return;
  }

  e.moving = false;
  e.direction = a.faceDir;
  const player = a.player;
  e._approach = null;
  triggerDialogue(state, e, player);
}

function triggerDialogue(state, e, player) {
  const finish = () => {
    player._frozen = false;
    setValue(`npc_interactions.${e.id}`, 1);   // persist the one-time disarm
    activeCount = Math.max(0, activeCount - 1);
  };
  // Intercepted players are always local (localTargets filters guests), so the
  // shop-on-greeting path is enabled.
  const promise = openDialogueWithEntity(state, player, e, { local: true });
  if (promise && typeof promise.then === "function") promise.then(finish);
  else finish();
}

// Bail out of a half-finished approach (NPC frame gone, player lost): release
// the freeze so the player can't get stuck and keep the active count honest.
function abortApproach(e) {
  const a = e._approach;
  if (a?.player) a.player._frozen = false;
  e._approach = null;
  // The encounter never reached its dialogue, so it was never persisted —
  // re-arm the mark so a later pass can intercept again.
  e.demands_attention = true;
  activeCount = Math.max(0, activeCount - 1);
}

function directionFor(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}
