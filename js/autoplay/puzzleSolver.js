// Zone-local route/puzzle search: can the player get from a start tile to
// any goal tile, and what does it take — walking and pushing blocks onto
// pressure plates.
//
// Region-based Sokoban search (the only tractable shape for SneakBit's
// 8k–19k-tile dungeons). Between pushes the player walks freely, so the
// macro-state is (pushable positions, player's connected region) — the
// player's exact tile collapses to "which connected region it's in". That
// turns ~8000 player positions per pushable layout into a single flood
// fill, and the search frontier into layout × region states.
//
// Gates are controlled SOLELY by pressure plates (the game's design): a
// Gate is open while its color plate is held down, an InverseGate while
// it's up. Keys (species 2000–2005) are pure collectibles for the finale
// — they never open gates — so the solver has no key logic at all.
//
// A plate is held down by a pushable resting on it OR by the player
// standing on it (puzzles.js updatePlates). The player's weight is
// transient, so it's modelled per-EDGE rather than as persistent state:
// every collision check the engine runs (step commit, push validation)
// happens while the player still stands on the source tile, so that
// tile's plate color reads as down for exactly that move. This lets the
// player walk ONE tile from a plate into an adjacent same-color Gate, and
// push a box through a gate held open by their own weight. Some dungeons
// (e.g. 1005: three plate colors, two boxes) are unsolvable without it.
//
// Boxes barely block the player (player.js share-tile escape hatch): a
// pinned box can be climbed and walked through, a box on a closed gate
// tile bridges it, and a climbed box can be pushed off in any direction
// it can slide. See flood()/successors() for the exact edge rules.
//
// Per the perf rule, nothing in the inner loop scans zone.entities: the
// static blocked set, gate-by-tile and plate-by-color maps are built once
// per solve.

import { tileKey, gateLock } from "./worldModel.js";
import { shouldBeVisible } from "../entityVisibility.js";
import { LOCK_NONE, LOCK_PERMANENT } from "../locks.js";

const DIRS = [
  { name: "up",    dx: 0,  dy: -1 },
  { name: "down",  dx: 0,  dy: 1 },
  { name: "left",  dx: -1, dy: 0 },
  { name: "right", dx: 1,  dy: 0 },
];

// With share-tile mechanics the macro space of a 4-box dungeon is far too
// large to exhaust — the cap is the real terminator for unreachable
// goals, so it must be affordable: ~30k states ≈ a minute in the biggest
// zone, while every known-solvable puzzle needs well under 5k.
const DEFAULT_MAX_STATES = 30000;

// opts:
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
  world.goalD = goalField(world, goals);
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

  // Macro-state = pushable layout + the player's connected component
  // (its canonical tile). The same layout with the player walled into a
  // different pocket is a different state — keying on layout alone prunes
  // reachable branches.
  //
  // Greedy best-first over the deduped macro graph: the share-tile
  // mechanics make boxes movable almost anywhere, so blind BFS drowns in
  // free-floor shuffles. Expansion order is steered by score() (gate
  // colors still up, boxes far from goal-side plates); dedup keeps the
  // search complete — exhaustion still means unreachable.
  const startKey = macroKey(startState, startRegion);
  const seen = new Map([[startKey, null]]);
  const heap = makeHeap();
  heapPush(heap, score(world, startState, startRegion), { state: startState, key: startKey });
  let explored = 1;

  while (heap.length) {
    const { state, key } = heapPop(heap);
    // Regions are recomputed on pop rather than carried in the heap — a
    // flooded region is a Set of thousands of tile keys, and retaining one
    // per queued state OOMs the hard dungeons.
    const region = reachableRegion(world, state);
    for (const succ of successors(world, state, region, allowPush)) {
      const region2 = reachableRegion(world, succ.state);
      const key2 = macroKey(succ.state, region2);
      if (seen.has(key2)) continue;
      seen.set(key2, { prev: key, move: succ.move });
      explored++;
      const hit = goalInRegion(region2);
      if (hit) return done(world, reconstruct(seen, key2), tileOf(hit), hit);
      if (explored >= maxStates) return fail("state cap", explored);
      heapPush(heap, score(world, succ.state, region2), { state: succ.state, key: key2 });
    }
  }
  return fail("exhausted", explored);
}

// All-gates-open BFS distance field from the goal tiles, ignoring boxes.
// A lower bound on the player's remaining walk, defined on both sides of
// every gate — the flood reads it to find which closed gate stands
// between the current region and the goal.
function goalField(world, goals) {
  const d = new Map();
  let frontier = [];
  for (const g of goals) {
    if (world.baseBlocked.has(g)) continue;
    d.set(g, 0);
    frontier.push(g);
  }
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const cur of frontier) {
      const [x, y] = parseTile(cur);
      for (const dir of DIRS) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= world.model.cols || ny >= world.model.rows) continue;
        const nk = tileKey(nx, ny);
        if (d.has(nk) || world.baseBlocked.has(nk)) continue;
        d.set(nk, dist);
        next.push(nk);
      }
    }
    frontier = next;
  }
  return d;
}

// Expansion priority (lower = sooner). The bottleneck of every puzzle is
// the closed gate nearest the goal on the region's boundary (gateStar,
// found during the flood): score = the region's best goal distance, plus
// — while a gate still blocks — the cost of fixing THAT gate: walking a
// box onto its color's plate (Gate) or off it (InverseGate). Scoring only
// the blocking color avoids the sum-over-colors trap where moving a box
// toward the needed plate walks it away from an irrelevant one.
function score(world, state, region) {
  let h = region.goalD;
  if (region.gateStar) {
    h += 1000;
    if (region.gateStar.kind === "Gate") {
      const field = plateField(world, region.gateStar.color, region.pushDown);
      let best = 500;
      for (const bk of state.pushables.keys()) {
        // A box parked on another color's plate is a decoy — it's
        // holding that gate open, not available for this one. Counting
        // it flattens the gradient for the box actually en route.
        const parkedOn = world.plateColorAt.get(bk);
        if (parkedOn != null && parkedOn !== region.gateStar.color) continue;
        const d = field.get(bk);
        if (d != null && d < best) best = d;
      }
      h += best;
    } else {
      h += 1; // inverse gate closed = a box weights the plate; shove it off
    }
  }
  return h;
}

// Penalty for pushing a box through a gate whose color isn't currently
// held: that gate needs its own plate filled first. Crossing it isn't
// impossible — just expensive — which is exactly what makes prerequisite
// pushes (fill the blue plate so the green box's corridor opens) improve
// the score instead of looking like noise.
const UNHELD_GATE_COST = 50;

// Box-path distance field to `color`'s plate over box-traversable tiles.
// Gates cost 1 to cross when their color is held, UNHELD_GATE_COST + 1
// when not. Memoized per (color, held-set) — at most 2^colors variants.
function plateField(world, color, pushDown) {
  const held = [...world.plateTilesByColor.keys()].filter((c) => pushDown.has(c)).sort().join(",");
  const cacheKey = `${color}|${held}`;
  let field = world.plateFields.get(cacheKey);
  if (field) return field;
  field = new Map();
  const heap = makeHeap();
  const tiles = world.plateTilesByColor.get(color);
  if (tiles) for (const k of tiles) { field.set(k, 0); heapPush(heap, 0, k); }
  while (heap.length) {
    const cur = heapPop(heap);
    const base = field.get(cur);
    const [x, y] = parseTile(cur);
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= world.model.cols || ny >= world.model.rows) continue;
      const nk = tileKey(nx, ny);
      if (world.boxBlocked.has(nk)) continue;
      const g = world.gateAt.get(nk);
      const cost = base + 1 + (g && !pushDown.has(gateLock(g)) && gateLock(g) !== LOCK_NONE ? UNHELD_GATE_COST : 0);
      if ((field.get(nk) ?? Infinity) <= cost) continue;
      field.set(nk, cost);
      heapPush(heap, cost, nk);
    }
  }
  world.plateFields.set(cacheKey, field);
  return field;
}

// --- tiny binary min-heap (score, payload) --------------------------------

function makeHeap() {
  return [];
}

function heapPush(h, s, v) {
  h.push({ s, v });
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].s <= h[i].s) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h) {
  const top = h[0].v;
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l].s < h[m].s) m = l;
      if (r < h.length && h[r].s < h[m].s) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

// Pushable layouts reachable by pushing ONE box along ONE direction from
// `state`, given the player's current `region`. Two engine-true push
// origins: standing behind the block (canEnter → pushOneTile), or
// standing ON it — the share-tile escape hatch lets the player climb a
// pinned block, and pressing any direction the block can slide moves it
// (startStep's standingOn branch). Either way the player ends on the
// block's old tile.
//
// Line macro: one call emits EVERY stop along the slide line, not just
// the first — the player follows one tile behind, so each further push
// is always legal to attempt. Long corridors thus cost one heap pop
// instead of one pop (plus full sibling fan-out) per tile. Gate states
// are re-read per step: the moving box holds each plate it crosses, and
// the player's self-weight tile is the box's previous tile.
function successors(world, state, region, allowPush) {
  const out = [];
  if (!allowPush) return out;
  for (const [pos, id] of state.pushables) {
    const [px, py] = parseTile(pos);
    const onBox = region.tiles.has(pos);
    // Plate colors held by the OTHER boxes — the moving box's own
    // contribution is re-derived per step from its current tile.
    const others = new Set();
    for (const k of state.pushables.keys()) {
      if (k === pos) continue;
      const c = world.plateColorAt.get(k);
      if (c != null) others.add(c);
    }
    for (const dir of DIRS) {
      const behind = tileKey(px - dir.dx, py - dir.dy);
      let cur = pos;
      let playerTile = region.tiles.has(behind) ? behind : pos;
      if (playerTile === pos && !onBox) continue;
      for (;;) {
        const pd = (color) => others.has(color) || world.plateColorAt.get(cur) === color;
        let ok = boxCanSlide(world, state.pushables, cur, dir, playerTile, pd);
        // First step may be possible from the other origin (gate state
        // differs when the origin tile is a plate).
        if (!ok && cur === pos && playerTile === behind && onBox) {
          playerTile = pos;
          ok = boxCanSlide(world, state.pushables, cur, dir, pos, pd);
        }
        if (!ok) break;
        const [cx, cy] = parseTile(cur);
        const next = tileKey(cx + dir.dx, cy + dir.dy);
        const pushables = new Map(state.pushables);
        pushables.delete(pos);
        pushables.set(next, id);
        out.push({
          state: { pushables, player: cur },
          move: { push: id, dir: dir.name, blockTo: tileOf(next), playerTo: tileOf(cur) },
        });
        playerTile = cur;
        cur = next;
      }
    }
  }
  return out;
}

// Can the box at `fromKey` slide one tile along `dir` while the player
// stands on `playerTile`? Mirrors pushOneTile: terrain-walkable (boxes
// don't get the player's teleporter override), no rigid entity, no other
// box, and any gate on the target read with the player's weight applied
// (the engine validates the slide while the player still stands there).
function boxCanSlide(world, boxes, fromKey, dir, playerTile, plateDown) {
  const [px, py] = parseTile(fromKey);
  const tx = px + dir.dx;
  const ty = py + dir.dy;
  if (tx < 0 || ty < 0 || tx >= world.model.cols || ty >= world.model.rows) return false;
  const target = tileKey(tx, ty);
  if (world.boxBlocked.has(target)) return false;
  if (boxes.has(target)) return false;
  const g = world.gateAt.get(target);
  if (g && !gateOpen(world, g, withSelfWeight(world, plateDown, playerTile))) return false;
  return true;
}

// Plate weights as the engine sees them while the player stands on `tile`:
// the tile's own plate color (if any) reads as down on top of the
// pushable-held colors.
function withSelfWeight(world, plateDown, tile) {
  const selfColor = world.plateColorAt.get(tile);
  if (selfColor == null) return plateDown;
  return (color) => color === selfColor || plateDown(color);
}

// Flood the tiles the player can stand on in this macro-state. Returns
// { tiles, rep, plateDown, pushDown, goalD, gateStar }.
function reachableRegion(world, state) {
  // Colors held down by a pushable resting on a plate of that color.
  const pushDown = new Set();
  for (const [color, tiles] of world.plateTilesByColor) {
    for (const k of state.pushables.keys()) {
      if (tiles.has(k)) { pushDown.add(color); break; }
    }
  }
  const plateDown = makePlateDown(world, pushDown);
  const { tiles, goalD, gateStar } = flood(world, state.player, state.pushables, plateDown);
  // Directed reach: same min tile can front different reachable sets, so
  // the canonical key carries the size too.
  let rep = state.player;
  for (const k of tiles) if (k < rep) rep = k;
  return { tiles, rep: `${rep}#${tiles.size}`, plateDown, pushDown, goalD, gateStar };
}

// plateDown(color): down if a pushable holds the plate. Puzzles are
// zone-local by design — every gate color has a plate in the same zone
// (asserted by the data-invariant test), so there is no cross-zone
// fallback: an absent plate just reads as up.
function makePlateDown(world, pushDown) {
  return (color) => pushDown.has(color);
}

// State-preserving walk flood. Engine-true edge rules (player.js
// canEnter/startStep), all checked at step-commit time with the player's
// weight still on the source tile, so the flood is directed:
//   - Stepping while standing on a box that can slide that way moves the
//     box instead of the player — not a walk edge (it's a push successor).
//   - Stepping INTO a box's tile is a push when the box can slide on; only
//     a pinned box can be climbed (share-tile escape hatch). The pushable
//     branch precedes the gate check, so a box parked on a closed gate is
//     a bridge through it.
//   - Otherwise a gate on the target is read with self-weight: a plate
//     tile lets the player walk one tile into an adjacent same-color Gate
//     (and blocks an adjacent InverseGate). Exiting a gate tile is free —
//     the engine only checks destinations.
function flood(world, seed, boxes, plateDown) {
  const goalD = world.goalD;
  let bestD = goalD ? (goalD.get(seed) ?? Infinity) : Infinity;
  let gateStar = null;
  let gateStarD = Infinity;
  const seen = new Set([seed]);
  const q = [seed];
  while (q.length) {
    const cur = q.pop();
    const [x, y] = parseTile(cur);
    const onBox = boxes.has(cur);
    for (const dir of DIRS) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= world.model.cols || ny >= world.model.rows) continue;
      const nk = tileKey(nx, ny);
      if (seen.has(nk)) continue;
      if (onBox && boxCanSlide(world, boxes, cur, dir, cur, plateDown)) continue;
      if (world.baseBlocked.has(nk)) continue;
      if (boxes.has(nk)) {
        if (boxCanSlide(world, boxes, nk, dir, cur, plateDown)) continue;
      } else {
        const g = world.gateAt.get(nk);
        if (g && !gateOpen(world, g, withSelfWeight(world, plateDown, cur))) continue;
      }
      if (goalD) {
        const d = goalD.get(nk);
        if (d != null && d < bestD) bestD = d;
      }
      seen.add(nk);
      q.push(nk);
    }
  }
  // Closed boundary gate nearest the goal — re-walk the region rim. Done
  // as a second pass so a gate first probed from a far tile but also
  // adjacent to a near one isn't mis-ranked.
  if (goalD) {
    for (const cur of seen) {
      const [x, y] = parseTile(cur);
      for (const dir of DIRS) {
        const nk = tileKey(x + dir.dx, y + dir.dy);
        if (seen.has(nk) || boxes.has(nk)) continue;
        const g = world.gateAt.get(nk);
        if (!g || gateOpen(world, g, withSelfWeight(world, plateDown, cur))) continue;
        const d = goalD.get(nk);
        if (d != null && d < gateStarD) {
          gateStarD = d;
          gateStar = { color: gateLock(g), kind: g.kind };
        }
      }
    }
  }
  return { tiles: seen, goalD: bestD, gateStar };
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
  // Boxes obey raw terrain + entity collision (pushOneTile: isWalkable +
  // isEntityBlocked) — no teleporter override, so interior exit doors on
  // unwalkable tiles stay box-proof.
  const boxBlocked = new Set(baseBlocked);
  // Enterable teleporters override terrain AND entity collision for the
  // PLAYER (player.js::canEnter) — interior exit doors sit on unwalkable
  // tiles.
  for (const k of model.enterableTeleporterTiles) baseBlocked.delete(k);
  // Explosive barrels die to bullets/melee (combat.js) — passable for the
  // solver, for boxes too: the player clears the barrel before shoving a
  // box through.
  for (const k of model.destructibleTiles) {
    baseBlocked.delete(k);
    boxBlocked.delete(k);
  }

  const gateAt = new Map();
  for (const g of model.gates) for (const k of g.tiles) gateAt.set(k, g);

  const plateTilesByColor = new Map();
  const plateColorAt = new Map();
  for (const p of model.plates) {
    if (!plateTilesByColor.has(p.color)) plateTilesByColor.set(p.color, new Set());
    const set = plateTilesByColor.get(p.color);
    for (const k of p.tiles) {
      set.add(k);
      plateColorAt.set(k, p.color);
    }
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
    boxBlocked,
    gateAt,
    plateTilesByColor,
    plateColorAt,
    pushableStart,
    plateFields: new Map(),
  };
}

function macroKey(state, region) {
  return [...state.pushables.keys()].sort().join(";") + "|" + region.rep;
}

function reconstruct(seen, endKey) {
  const moves = [];
  let key = endKey;
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
