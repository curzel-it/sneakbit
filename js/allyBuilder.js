// Tower Defense ally BUILDER: drives every un-possessed hero during the BUILD
// phase between waves. While allyAI.js fights the horde during a wave, this is
// its quiet-time counterpart — idle allies pitch in on the fort the player is
// shaping, herding the loose stones (species 1030) toward the exit so they pile
// into a maze in front of the goal.
//
// The idea, kept deliberately simple and emergent:
//   • A stone is pushed by a hero standing on the tile BEHIND it and stepping
//     in. The push direction is the way the horde would step from the stone's
//     tile — the live flow field's goal-ward arrow — so every push moves the
//     stone one step along the *current* creep path. Land stones on that path
//     and they lengthen the route exactly where it counts; as the player's own
//     walls bend the path, the allies follow the new path, so they extend the
//     player's maze rather than fight it.
//   • Field distance to the goal strictly decreases per push, so pushes never
//     oscillate. Stones settle in a band EXIT_STANDOFF tiles out from the goal
//     (its immediate neighbourhood stays open so the player can still maneuver).
//   • A hard reachability guard (pushWouldSeal) means an ally never closes the
//     last gap — the horde always keeps a route, so the maze can't soft-lock.
//
// Stones are claimed per hero (index → stone id) so two allies don't fight over
// the same boulder. With nothing left to move an ally drifts back to the camera
// (seekVisibleArea) and out of the player's way. Cleared each build phase via
// resetAllyBuilder so work is redistributed as fresh stones drop.

import { isWalkable } from "./zone.js";
import { isPushable } from "./pushables.js";
import { stoneBlocksTile } from "./tdStones.js";
import { getField, getGoal, getSpawns } from "./tdBoard.js";
import { computeFlowField, fieldDistance, allReachable } from "./flowField.js";
import { pathStepToward, seekVisibleArea } from "./allyAI.js";

const EXIT_STANDOFF = 2;          // stones park this many tiles out from the goal

const STEP_DIRS = [["up", 0, -1], ["down", 0, 1], ["left", -1, 0], ["right", 1, 0]];

const IDLE = () => ({ events: [], held: new Set() });
const walk = (dir) => ({ events: [dir], held: new Set([dir]) });

// Each builder's claimed stone, by hero index → stone id. Sticky so an ally
// finishes herding one boulder before grabbing the next, and so two allies
// never target the same stone. Cleared per build phase via resetAllyBuilder.
const claimedStoneId = new Map();

export function resetAllyBuilder() { claimedStoneId.clear(); }

// Drive one ally for this build-phase frame. Returns the movement input to hand
// to updatePlayer (same `{ events, held }` shape pollInput returns), with one
// extra flag: `push` is true ONLY on the deliberate goal-ward shove — the frame
// the hero stands on the push stance and steps into the stone. The caller gates
// updatePlayer's canPush on it, so the builder shoves a stone solely on that
// step. On every other frame (walking to a stance, drifting back to camera) the
// hero treats stones as walls. Without this gate a builder that walked onto a
// stone — e.g. a push that failed because another mover shifted the board this
// frame, before the once-per-frame field recompute — would drag it sideways via
// updatePlayer's carry-back, hauling loose stones to random corners instead of
// the exit. `ctx` = { goal?, otherHeroTile? }.
export function driveBuilder(state, hero, ctx) {
  const zone = state?.zone;
  if (!zone) return IDLE();
  // Mid-step: let the current tile-step land before deciding the next move. The
  // movement model chains a *held* direction through the arrival snap, so issuing
  // a fresh navigate every frame overshoots the exact push stance by a tile (then
  // circles back forever) in the tight TD arena. Reassessing only from a settled
  // tile keeps the builder's positioning precise enough to land each shove.
  if (hero.step) return IDLE();
  const stones = liveStones(zone);
  if (!stones.length) return seekVisibleArea(state, hero);

  const intent = planBuilderMove({
    zone,
    hero,
    stones,
    field: getField(),
    goal: ctx?.goal || getGoal(),
    spawns: getSpawns(),
    claims: claimedStoneId,
    otherHeroTile: ctx?.otherHeroTile || null,
  });

  if (intent.kind === "push") {
    hero.direction = intent.dir;     // face the stone so the shove reads right
    return { ...walk(intent.dir), push: true };
  }
  if (intent.kind === "navigate") return walk(intent.dir);
  return seekVisibleArea(state, hero);
}

// — Pure decision core (unit-tested without the tdBoard singletons) ———————————
//
// Picks this hero's stone and the step to take on it. Returns one of:
//   { kind: "push",     dir, stoneId }  — on the push stance: step to shove it
//   { kind: "navigate", dir, stoneId }  — walk one step toward the push stance
//   { kind: "idle" }                    — nothing to do (regroup)
// Mutates `claims` (hero index → stone id) to record/clear the claim.
export function planBuilderMove({ zone, hero, stones, field, goal, spawns, claims, otherHeroTile }) {
  if (!zone || !field) return { kind: "idle" };
  const hx = hero.tileX | 0;
  const hy = hero.tileY | 0;
  const idx = hero.index | 0;

  const claimedByOthers = new Set();
  for (const [k, v] of claims) if (k !== idx) claimedByOthers.add(v);

  // Reuse the standing claim if it's still a live, movable stone; otherwise take
  // the nearest unclaimed movable one (first hit in hero-distance order — cheap,
  // and it bounds the per-frame seal checks to a handful). Stones the player has
  // shoved (_playerPlaced) are never targeted — those are the player's own maze.
  let chosen = null;
  let plan = null;

  const prevId = claims.get(idx);
  if (prevId != null) {
    const s = stones.find((e) => e.id === prevId);
    const p = s && !s._playerPlaced ? pushPlanFor(s, field, zone, goal, spawns, hx, hy, otherHeroTile) : null;
    if (p) { chosen = s; plan = p; }
  }

  if (!chosen) {
    const ordered = stones
      .filter((s) => !claimedByOthers.has(s.id) && !s._playerPlaced)
      .map((s) => ({ s, d: manhattan(hx, hy, s.frame.x | 0, s.frame.y | 0) }))
      .sort((a, b) => a.d - b.d);
    for (const { s } of ordered) {
      const p = pushPlanFor(s, field, zone, goal, spawns, hx, hy, otherHeroTile);
      if (p) { chosen = s; plan = p; break; }
    }
  }

  if (!chosen) { claims.delete(idx); return { kind: "idle" }; }
  claims.set(idx, chosen.id);

  if (hx === plan.stance.x && hy === plan.stance.y) {
    return { kind: "push", dir: plan.pushDir, stoneId: chosen.id };
  }
  const step = pathStepToward(zone, hx, hy, plan.stance, otherHeroTile);
  // No route to the stance (e.g. boxed in by the other hero) — drop the claim so
  // next frame is free to pick a different stone rather than stalling on this one.
  if (!step) { claims.delete(idx); return { kind: "idle" }; }
  return { kind: "navigate", dir: step, stoneId: chosen.id };
}

// The plan to advance one stone one tile toward the exit, or null if it's parked
// (in the exit band, walled in, or every goal-ward push is unreachable or would
// seal the goal off).
function pushPlanFor(stone, field, zone, goal, spawns, hx, hy, isHeroTile) {
  const sx = stone.frame.x | 0;
  const sy = stone.frame.y | 0;

  // The stone's distance to the goal = the nearest in-field neighbour + 1. We
  // read NEIGHBOURS, not the stone's own tile — the live field has that tile
  // blocked, so its arrow there is null.
  let bestDist = Infinity;
  for (const [, dx, dy] of STEP_DIRS) {
    const d = fieldDistance(field, sx + dx, sy + dy);
    if (Number.isFinite(d) && d < bestDist) bestDist = d;
  }
  if (!Number.isFinite(bestDist)) return null;     // walled in → stuck
  if (bestDist + 1 <= EXIT_STANDOFF) return null;  // already in the exit band → done

  // Any neighbour at that minimum distance is one step closer to the goal, so a
  // push toward it advances the stone down the creep path. Among those, take a
  // push we can actually make: the stance the hero already stands on (push now),
  // else the nearest usable stance — and never one that seals the goal off.
  let chosen = null;
  let chosenDist = Infinity;
  for (const [dir, dx, dy] of STEP_DIRS) {
    if (fieldDistance(field, sx + dx, sy + dy) !== bestDist) continue; // not goal-ward
    const stance = { x: sx - dx, y: sy - dy };       // behind the stone
    const onStance = stance.x === hx && stance.y === hy;
    if (!onStance && !stanceUsable(zone, stance, isHeroTile)) continue;
    // Never shove a stone onto a tile a hero stands on. Heroes aren't zone
    // entities, so pushOneTile would happily bury the stone under the idle
    // active hero — and then nobody can step onto that tile to push it on, so
    // the builder thrashes forever. Park the stone a tile short instead.
    if (isHeroTile && isHeroTile(sx + dx, sy + dy)) continue;
    if (pushWouldSeal(zone, { x: sx, y: sy }, { x: sx + dx, y: sy + dy }, goal, spawns)) continue;
    if (onStance) return { pushDir: dir, stance };   // already in position — shove it
    const hd = manhattan(stance.x, stance.y, hx, hy);
    if (hd < chosenDist) { chosen = { pushDir: dir, stance }; chosenDist = hd; }
  }
  return chosen;
}

// The push stance must be walkable, stone-free, and not held by another hero —
// otherwise the stone can't be shoved from that side this cycle.
function stanceUsable(zone, t, isHeroTile) {
  if (!isWalkable(zone, t.x, t.y)) return false;
  if (stoneBlocksTile(zone, t.x, t.y)) return false;
  if (isHeroTile && isHeroTile(t.x, t.y)) return false;
  return true;
}

// Would moving the stone from `from` to `next` seal the goal off from any spawn?
// Builds a trial flow field over a grid with the stone relocated and checks
// every spawn still reaches the goal. Runs once per chosen push, on the TD board
// (~60×40) — negligible, and it's the guard that keeps the maze always solvable.
function pushWouldSeal(zone, from, next, goal, spawns) {
  if (!goal || !spawns || !spawns.length) return false;
  const field = computeFlowField(trialGrid(zone, from, next), goal);
  return !allReachable(field, spawns);
}

// A nav grid with one stone relocated: `freed` reads as open (the stone left it)
// and `blocked` reads as solid (the stone arrived). Every other stone and wall
// blocks as usual.
function trialGrid(zone, freed, blocked) {
  return {
    cols: zone.cols,
    rows: zone.rows,
    isBlocked: (x, y) => {
      if (blocked && x === blocked.x && y === blocked.y) return true;
      if (!isWalkable(zone, x, y)) return true;
      if (freed && x === freed.x && y === freed.y) return false;
      return stoneBlocksTile(zone, x, y);
    },
  };
}

// — Stone queries ——————————————————————————————————————————————————————————
function liveStones(zone) {
  const out = [];
  const ents = zone?.entities;
  if (!ents) return out;
  for (const e of ents) {
    if (e._dying || !e.frame || !isPushable(e)) continue;
    out.push(e);
  }
  return out;
}

function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
