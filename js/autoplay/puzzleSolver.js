// Zone-local route/puzzle search: can the player get from a start tile to
// any goal tile, and what does it take — walking, pushing blocks onto
// pressure plates, spending colored keys on gates.
//
// Region-based Sokoban search (the only tractable shape for SneakBit's
// 8k–19k-tile dungeons). Between pushes the player walks freely, so the
// macro-state is just (pushable positions, keyed-open gates) — the
// player's exact tile collapses to "which connected region it's in". That
// turns ~8000 player positions per pushable layout into a single flood
// fill, and the search frontier into pushable layouts only.
//
// Gates are controlled SOLELY by pressure plates (the game's design): a
// Gate is open while its color plate is held down, an InverseGate while
// it's up. Keys (species 2000–2005) are pure collectibles for the finale
// — they never open gates — so the solver has no key logic at all.
//
// A plate is held down only by a pushable resting on it. The player's OWN
// transient weight is deliberately NOT modelled: it only holds while the
// player stands there, so treating it as persistent makes reachability
// asymmetric (walk into a pocket you can't walk out of). Pushable-on-plate
// keeps reachability symmetric, so the route planner can re-solve from any
// tile without stranding.
//
// Per the perf rule, nothing in the inner loop scans zone.entities: the
// static blocked set, gate-by-tile and plate-by-color maps are built once
// per solve.

import { tileKey, gateLock } from "./worldModel.js";
import { shouldBeVisible } from "../entityVisibility.js";
import { isPressurePlateDown, LOCK_NONE, LOCK_PERMANENT } from "../locks.js";

const DIRS = [
  { name: "up",    dx: 0,  dy: -1 },
  { name: "down",  dx: 0,  dy: 1 },
  { name: "left",  dx: -1, dy: 0 },
  { name: "right", dx: 1,  dy: 0 },
];

const DEFAULT_MAX_STATES = 200000;

// opts:
//   globalPlateDown: (color) => bool — plate flags for colors with no
//     plate in this zone (default: live storage)
//   pushableStarts: Map<entityId, {x,y}> — override start positions
//   maxStates: macro-state cap
//
// Returns { reachable, actions, platesLeftDown, statesExplored } or
// { reachable: false, reason, statesExplored }.
//
// actions is a high-level plan the route sim replays: { walkTo },
// { push, dir, blockTo, playerTo }. Intermediate footstep tiles are
// intentionally omitted — phase 2's in-page bot paths between waypoints
// with a plain BFS.
export function solveToTiles(model, startTile, goalTiles, opts = {}) {
  const goals = new Set(
    (Array.isArray(goalTiles) ? goalTiles : [goalTiles]).map((t) => tileKey(t.x, t.y)),
  );
  if (goals.size === 0) return fail("no goals", 0);

  const world = prepare(model, opts);
  const startKey = tileKey(startTile.x | 0, startTile.y | 0);
  const maxStates = opts.maxStates ?? DEFAULT_MAX_STATES;
  const startState = { pushables: world.pushableStart, player: startKey };

  // Phase A: plain walking (pushables frozen). Most objectives are simply
  // reachable on foot; only fall back to the expensive Sokoban search when
  // they aren't and the zone actually has blocks to push.
  const a = search(world, startState, goals, maxStates, false);
  if (a.reachable || world.pushableStart.size === 0) return a;
  return search(world, startState, goals, maxStates, true);
}

function search(world, startState, goals, maxStates, allowPush) {
  const goalInRegion = (region) => {
    for (const g of goals) if (region.tiles.has(g)) return g;
    return null;
  };
  const startRegion = reachableRegion(world, startState);
  const firstHit = goalInRegion(startRegion);
  if (firstHit) return done(world, [], tileOf(firstHit), firstHit);

  const seen = new Map([[macroKey(startState), null]]);
  let frontier = [{ state: startState, region: startRegion }];
  let explored = 1;

  while (frontier.length) {
    const next = [];
    for (const { state, region } of frontier) {
      for (const succ of successors(world, state, region, allowPush)) {
        const key = macroKey(succ.state);
        if (seen.has(key)) continue;
        const region2 = reachableRegion(world, succ.state);
        seen.set(key, { prev: macroKey(state), move: succ.move });
        explored++;
        const hit = goalInRegion(region2);
        if (hit) return done(world, reconstruct(seen, succ.state, hit), tileOf(hit), hit);
        if (explored >= maxStates) return fail("state cap", explored);
        next.push({ state: succ.state, region: region2 });
      }
    }
    frontier = next;
  }
  return fail("exhausted", explored);
}

// Pushable layouts reachable in one push from `state`, given the player's
// current `region`. The player stands behind a block (a region tile) and
// shoves it one tile into a clear tile ahead.
function successors(world, state, region, allowPush) {
  const out = [];
  if (!allowPush) return out;
  for (const [pos, id] of state.pushables) {
    const [px, py] = parseTile(pos);
    for (const dir of DIRS) {
      const behind = tileKey(px - dir.dx, py - dir.dy);
      if (!region.tiles.has(behind)) continue;
      const ax = px + dir.dx;
      const ay = py + dir.dy;
      if (ax < 0 || ay < 0 || ax >= world.model.cols || ay >= world.model.rows) continue;
      const ahead = tileKey(ax, ay);
      if (!pushableCanEnter(world, ahead, state, region)) continue;
      const pushables = new Map(state.pushables);
      pushables.delete(pos);
      pushables.set(ahead, id);
      out.push({
        state: { pushables, player: pos },
        move: { push: id, dir: dir.name, blockTo: { x: ax, y: ay }, playerTo: tileOf(pos) },
      });
    }
  }
  return out;
}

// Can a pushable be shoved onto `ahead`? Not into terrain/rigid, not onto
// another pushable, not through a closed gate or teleporter.
function pushableCanEnter(world, ahead, state, region) {
  if (world.baseBlocked.has(ahead)) return false;
  if (state.pushables.has(ahead)) return false;
  if (world.model.enterableTeleporterTiles.has(ahead)) return false;
  const g = world.gateAt.get(ahead);
  if (g && !gateOpen(world, g, region.plateDown)) return false;
  return true;
}

// Flood the tiles the player can stand on in this macro-state. Returns
// { tiles:Set, rep:canonicalTileKey, plateDown:(color)=>bool }.
function reachableRegion(world, state) {
  const blockTiles = new Set(state.pushables.keys());
  // Colors held down by a pushable resting on a plate of that color.
  const pushDown = new Set();
  for (const [color, tiles] of world.plateTilesByColor) {
    for (const k of state.pushables.keys()) {
      if (tiles.has(k)) { pushDown.add(color); break; }
    }
  }
  const plateDown = makePlateDown(world, pushDown);
  const tiles = flood(world, state.player, blockTiles, plateDown);
  let rep = state.player;
  for (const k of tiles) if (k < rep) rep = k;
  return { tiles, rep, plateDown, pushDown };
}

// plateDown(color): down if a pushable holds the plate. Colors with no
// plate in this zone fall back to the persisted global flag (cross-zone
// gating).
function makePlateDown(world, pushDown) {
  return (color) => {
    if (world.plateTilesByColor.has(color)) return pushDown.has(color);
    return !!world.globalPlateDown(color);
  };
}

function flood(world, seed, blockTiles, plateDown) {
  const seen = new Set([seed]);
  const q = [seed];
  while (q.length) {
    const cur = q.pop();
    const [x, y] = parseTile(cur);
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= world.model.cols || ny >= world.model.rows) continue;
      const nk = tileKey(nx, ny);
      if (seen.has(nk)) continue;
      if (world.baseBlocked.has(nk)) continue;
      if (blockTiles.has(nk)) continue;
      const g = world.gateAt.get(nk);
      if (g && !gateOpen(world, g, plateDown)) continue;
      seen.add(nk);
      q.push(nk);
    }
  }
  return seen;
}

// A Gate is open while its color plate is down; an InverseGate while it's
// up. Lock-None gates are always open; Permanent never.
function gateOpen(world, gate, plateDown) {
  const lock = gateLock(gate);
  if (lock === LOCK_PERMANENT) return false;
  if (gate.kind === "Gate") return lock === LOCK_NONE || !!plateDown(lock);
  return lock === LOCK_NONE || !plateDown(lock);
}

// Tiles the player can stand on by plain walking from `startTile`, given
// the current pushable layout and plate-controlled gates. No pushes — the
// cheap question the route planner asks every drain iteration. Returns a
// Set of "x,y".
export function reachableTiles(model, startTile, opts = {}) {
  const world = prepare(model, opts);
  const state = {
    pushables: world.pushableStart,
    player: tileKey(startTile.x | 0, startTile.y | 0),
  };
  return reachableRegion(world, state).tiles;
}

// --- setup + helpers -----------------------------------------------------

function prepare(model, opts) {
  const baseBlocked = new Set(model.staticBlocked);
  const entityBlocked = [];
  for (const k of model.rigidStaticTiles) entityBlocked.push(k);
  for (const k of model.lockedTeleporterTiles) baseBlocked.add(k);
  for (const c of model.conditionalRigid) {
    if (!shouldBeVisible(c.entity)) continue;
    for (const k of c.tiles) entityBlocked.push(k);
  }
  for (const k of entityBlocked) {
    if (!model.enterableTeleporterTiles.has(k)) baseBlocked.add(k);
  }
  // Enterable teleporters override terrain AND entity collision
  // (player.js::canEnter) — interior exit doors sit on unwalkable tiles.
  for (const k of model.enterableTeleporterTiles) baseBlocked.delete(k);

  const gateAt = new Map();
  for (const g of model.gates) for (const k of g.tiles) gateAt.set(k, g);

  const plateTilesByColor = new Map();
  for (const p of model.plates) {
    if (!plateTilesByColor.has(p.color)) plateTilesByColor.set(p.color, new Set());
    const set = plateTilesByColor.get(p.color);
    for (const k of p.tiles) set.add(k);
  }

  const pushableStart = new Map();
  if (opts.pushableStarts) {
    for (const [id, t] of opts.pushableStarts) pushableStart.set(tileKey(t.x, t.y), id);
  } else {
    for (const p of model.pushables) pushableStart.set(tileKey(p.start.x, p.start.y), p.entityId);
  }

  return {
    model,
    baseBlocked,
    gateAt,
    plateTilesByColor,
    pushableStart,
    globalPlateDown: opts.globalPlateDown ?? ((color) => isPressurePlateDown(color)),
  };
}

function macroKey(state) {
  return [...state.pushables.keys()].sort().join(";");
}

function reconstruct(seen, endState, goalKey) {
  const moves = [];
  let key = macroKey(endState);
  while (key) {
    const rec = seen.get(key);
    if (!rec) break;
    moves.push(rec.move);
    key = rec.prev;
  }
  moves.reverse();
  return moves;
}

function done(world, moves, goalTile, goalKey) {
  const actions = [...moves, { walkTo: goalTile }];
  // platesLeftDown: colors a pushable rests on in the final layout.
  const finalPushables = finalLayout(world, moves);
  const platesLeftDown = [];
  for (const [color, tiles] of world.plateTilesByColor) {
    for (const k of finalPushables) {
      if (tiles.has(k)) { platesLeftDown.push(color); break; }
    }
  }
  return { reachable: true, actions, platesLeftDown, statesExplored: 0 };
}

// Replay pushes over the start layout to get the final pushable tiles.
function finalLayout(world, moves) {
  const layout = new Map(world.pushableStart); // tileKey -> id
  for (const m of moves) {
    if (m.push == null) continue;
    // find current tile of this id
    let from = null;
    for (const [k, id] of layout) if (id === m.push) { from = k; break; }
    if (from == null) continue;
    layout.delete(from);
    layout.set(tileKey(m.blockTo.x, m.blockTo.y), m.push);
  }
  return new Set(layout.keys());
}


function fail(reason, explored) {
  return { reachable: false, reason, statesExplored: explored };
}

function parseTile(k) {
  const i = k.indexOf(",");
  return [parseInt(k.slice(0, i), 10), parseInt(k.slice(i + 1), 10)];
}

function tileOf(k) {
  const [x, y] = parseTile(k);
  return { x, y };
}
