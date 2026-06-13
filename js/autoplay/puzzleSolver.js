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
// Perf (the plan's Defect B): a solve floods the region once per explored
// state, so the flood is the hot loop. Tiles are int-packed (y*cols+x)
// the moment prepare() ingests the model — the search never touches an
// "x,y" string — and the flood marks visits in a generation-stamped
// Int32Array scratch shared across the solve (no per-flood Set, no
// clearing). Nothing in the inner loop scans zone.entities either: the
// static blocked mask, gate-by-tile and plate-by-color maps are built
// once per solve.

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
// goals, so it must be affordable: every known-solvable puzzle (including
// 1013's far-corner key, the worst case) needs well under this.
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
  const world = prepare(model, opts);
  const goals = new Set(
    (Array.isArray(goalTiles) ? goalTiles : [goalTiles])
      .map((t) => world.idx(t.x, t.y))
      .filter((i) => i >= 0),
  );
  if (goals.size === 0) return fail("no goals", 0);

  world.goalSet = goals;
  world.goalD = goalField(world, goals);
  const start = world.idx(startTile.x | 0, startTile.y | 0);
  if (start < 0) return fail("start out of bounds", 0);
  const maxStates = opts.maxStates ?? DEFAULT_MAX_STATES;
  const startState = { pushables: world.pushableStart, player: start };

  // Phase A: plain walking (pushables frozen). Most objectives are simply
  // reachable on foot; only fall back to the expensive Sokoban search when
  // they aren't and the zone actually has blocks to push.
  const a = search(world, startState, maxStates, false);
  if (a.reachable || world.pushableStart.size === 0) return a;

  // Phase A.5: sub-goal decomposition (see decompose). Solves the 4+ box
  // dungeons the joint search can't. Strict fallback below — never regresses.
  const decomp = decompose(world, startState, maxStates);
  if (decomp) {
    const fr = reachableRegion(world, decomp.state);
    if (fr.goalHit >= 0) return done(world, decomp.moves, world.tileOf(fr.goalHit));
  }
  return search(world, startState, maxStates, true);
}

function search(world, startState, maxStates, allowPush) {
  const startRegion = reachableRegion(world, startState);
  if (startRegion.goalHit >= 0) return done(world, [], world.tileOf(startRegion.goalHit));

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
    // flooded region covers thousands of tiles, and retaining one per
    // queued state OOMs the hard dungeons. NOTE: the popped region's
    // stamp-backed has() is only valid until the next flood, so all
    // successors are generated before any of them is flooded.
    const region = reachableRegion(world, state);
    for (const succ of successors(world, state, region, allowPush)) {
      const region2 = reachableRegion(world, succ.state);
      const key2 = macroKey(succ.state, region2);
      if (seen.has(key2)) continue;
      seen.set(key2, { prev: key, move: succ.move });
      explored++;
      if (region2.goalHit >= 0) return done(world, reconstruct(seen, key2), world.tileOf(region2.goalHit));
      if (explored >= maxStates) return fail("state cap", explored);
      heapPush(heap, score(world, succ.state, region2), { state: succ.state, key: key2 });
    }
  }
  return fail("exhausted", explored);
}

// --- sub-goal decomposition ------------------------------------------------
//
// The joint search (above) drowns in the free-floor box-shuffle space once a
// dungeon has 4+ boxes (zones 1013, 1021): it explores hundreds of thousands
// of macro-states without converging. But these puzzles have structure — to
// reach the goal you open the colored gates between you and it, and a gate
// opens when SOME box sits on its color's plate. So instead of one giant joint
// search, solve it as a sequence of single-box sub-solves: look at the gate
// currently blocking the goal (the flood already names it — region.gateStar),
// fully solve "get a box onto that color's plate", commit the pushes, and
// repeat. Each sub-solve moves exactly ONE box (others frozen, still holding
// their plates), so its search is tiny. Greedily fixing the goal-nearest
// blocking gate first naturally discovers the dependency order
// (yellow→blue→red→green in 1013). If any step can't be made — no gateStar, a
// sub-solve fails, or no progress — we bail to the joint search, so a dungeon
// this can't crack behaves exactly as it does today (no regression).

// Drive the decomposition. Returns { moves, state } where `moves` is the full
// push list from world.pushableStart (so done()/finalLayout replay correctly)
// and `state` is the final layout that reaches the goal — or null to fall back.
//
// At each step every plate is a candidate sub-goal: fill it if empty, clear it
// if a box already weighs it. We try them (goal-relevant colors first) and
// commit the first whose single-box sub-solve makes real progress — the goal
// is reached/closer, OR the reachable region simply GREW. That last signal is
// the key: the prerequisite move in 1013 is filling the yellow plate, which
// doesn't shorten the goal distance but opens the yellow gate you walk through
// to reach the blue box — pure region growth. Greedily taking whatever grows
// the region discovers the yellow→blue→red→green order on its own. If nothing
// helps we bail to the joint search, so un-decomposable zones never regress.
function decompose(world, startState, maxStates) {
  let state = { pushables: new Map(startState.pushables), player: startState.player };
  const allMoves = [];
  const budget = { left: maxStates };
  const cap = (world.pushableStart.size + 2) * 2;
  for (let iter = 0; iter < cap; iter++) {
    const region = reachableRegion(world, state);
    if (region.goalHit >= 0) return { moves: allMoves, state };
    const beforeD = region.goalD;
    const beforeN = region.tiles.length;
    let advanced = null;
    for (const cand of plateCandidates(world, region)) {
      const sub = subSolveBox(world, state, region, cand.color, cand.want, budget);
      if (budget.left <= 0) return null;
      if (!sub) continue;
      const after = reachableRegion(world, sub.state);
      if (after.goalHit >= 0 || after.goalD < beforeD || after.tiles.length > beforeN) {
        advanced = sub;
        break;
      }
    }
    if (!advanced) return null; // no plate toggle helped — joint search
    allMoves.push(...advanced.moves);
    state = advanced.state;
  }
  return null; // too many sub-goals — let the joint search try
}

// Plate sub-goals to try this step, best first: fill the empty plates (most
// puzzles open gates by weighting plates), then clear the held ones (for
// InverseGates / freeing a box), each ordered by how near that color's gates
// sit to the goal. `want` is "on" (box onto a plate of the color) or "off".
function plateCandidates(world, region) {
  const out = [];
  for (const color of world.plateTilesByColor.keys()) {
    out.push({ color, want: region.pushDown.has(color) ? "off" : "on", d: colorGoalD(world, color) });
  }
  out.sort((a, b) => (a.want === b.want ? a.d - b.d : a.want === "on" ? -1 : 1));
  return out;
}

// Nearest-to-goal distance among a color's gate tiles (all-gates-open field),
// for ordering candidates. Infinity if the color has no goal-reachable gate.
function colorGoalD(world, color) {
  let best = Infinity;
  if (!world.goalD) return best;
  for (const [tile, g] of world.gateAt) {
    if (gateLock(g) !== color) continue;
    const d = world.goalD[tile];
    if (d >= 0 && d < best) best = d;
  }
  return best;
}

// Solve one sub-goal: get SOME box onto ("on") / off ("off") a `color` plate,
// moving a single box at a time. Tries candidate boxes in order, first win.
function subSolveBox(world, state, region, color, want, budget) {
  const plateTiles = world.plateTilesByColor.get(color);
  if (!plateTiles) return null;
  for (const id of chooseCandidates(world, state, region, color, want, plateTiles)) {
    const res = oneBoxSearch(world, state, id, color, plateTiles, want, budget);
    if (res) return res;
  }
  return null;
}

// Which boxes to try, best first. "on": any box not already parked on ANOTHER
// color's plate (lifting it would re-close a gate we may still need), nearest
// to this color's plate first. "off": the box currently on the plate.
function chooseCandidates(world, state, region, color, want, plateTiles) {
  if (want === "off") {
    const out = [];
    for (const [k, id] of state.pushables) if (plateTiles.has(k)) out.push(id);
    return out;
  }
  const field = plateField(world, color, region.pushDown);
  const cand = [];
  for (const [k, id] of state.pushables) {
    if (plateTiles.has(k)) continue; // already on this color's plate
    const parked = world.plateColorAt.get(k);
    if (parked != null && parked !== color) continue;
    cand.push({ id, d: field[k] >= 0 ? field[k] : Infinity });
  }
  cand.sort((a, b) => a.d - b.d);
  return cand.map((c) => c.id);
}

// Cap on states explored per single-box sub-solve. A legit single-box push
// converges in a few hundred states (the line-macro makes long slides one
// pop); a box that simply can't reach the plate yet would otherwise flood its
// whole single-box space before failing. Capping it keeps the driver from
// burning the shared budget on doomed candidates (5-box 1021 went 9s → ~1s).
const SUBSOLVE_MAX_STATES = 1500;

// Single-box greedy best-first: mirror search() but push only `id` and stop
// when the sub-goal is hit. Bounded by a per-call cap AND the shared `budget`
// (so the whole decomposition can never exceed the caller's state cap).
// Returns { moves, state } or null.
function oneBoxSearch(world, startState, id, color, plateTiles, want, budget) {
  if (subGoalHit(startState, id, plateTiles, want)) {
    return { moves: [], state: startState };
  }
  const startRegion = reachableRegion(world, startState);
  const startKey = macroKey(startState, startRegion);
  const seen = new Map([[startKey, null]]);
  const heap = makeHeap();
  heapPush(heap, subScore(world, startState, id, color, want), { state: startState, key: startKey });
  let local = 0;

  while (heap.length) {
    const { state, key } = heapPop(heap);
    const region = reachableRegion(world, state);
    for (const succ of successors(world, state, region, true, id)) {
      const region2 = reachableRegion(world, succ.state);
      const key2 = macroKey(succ.state, region2);
      if (seen.has(key2)) continue;
      seen.set(key2, { prev: key, move: succ.move });
      if (subGoalHit(succ.state, id, plateTiles, want)) {
        return { moves: reconstruct(seen, key2), state: succ.state };
      }
      if (--budget.left <= 0 || ++local >= SUBSOLVE_MAX_STATES) return null;
      heapPush(heap, subScore(world, succ.state, id, color, want), { state: succ.state, key: key2 });
    }
  }
  return null;
}

// Sub-goal reached? The moving box is on ("on") / off ("off") a color plate.
function subGoalHit(state, id, plateTiles, want) {
  for (const [k, bid] of state.pushables) {
    if (bid !== id) continue;
    return want === "on" ? plateTiles.has(k) : !plateTiles.has(k);
  }
  return false;
}

// Priority for the single-box search: the box's box-path distance to its
// plate (toward it for "on"; away for "off", where any step off wins).
function subScore(world, state, id, color, want) {
  let boxTile = -1;
  for (const [k, bid] of state.pushables) if (bid === id) { boxTile = k; break; }
  if (boxTile < 0) return 1e9;
  const pushDown = new Set();
  for (const [c, tiles] of world.plateTilesByColor) {
    for (const k of state.pushables.keys()) { if (tiles.has(k)) { pushDown.add(c); break; } }
  }
  const d = plateField(world, color, pushDown)[boxTile];
  if (want === "on") return d >= 0 ? d : 1e9;
  return d >= 0 ? -d : 0;
}

// All-gates-open BFS distance field from the goal tiles, ignoring boxes.
// A lower bound on the player's remaining walk, defined on both sides of
// every gate — the flood reads it to find which closed gate stands
// between the current region and the goal. Int32Array over tiles, -1 =
// unreached.
function goalField(world, goals) {
  const d = new Int32Array(world.n).fill(-1);
  let frontier = [];
  for (const g of goals) {
    if (world.baseBlocked[g]) continue;
    d[g] = 0;
    frontier.push(g);
  }
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const cur of frontier) {
      for (const nk of world.neighbors(cur)) {
        if (nk < 0 || d[nk] >= 0 || world.baseBlocked[nk]) continue;
        d[nk] = dist;
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
        const d = field[bk];
        if (d >= 0 && d < best) best = d;
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

// Box-path distance field to `color`'s plate over box-traversable tiles
// (Int32Array, -1 = unreachable). Gates cost 1 to cross when their color
// is held, UNHELD_GATE_COST + 1 when not. Memoized per (color, held-set)
// — at most 2^colors variants.
function plateField(world, color, pushDown) {
  const held = [...world.plateTilesByColor.keys()].filter((c) => pushDown.has(c)).sort().join(",");
  const cacheKey = `${color}|${held}`;
  let field = world.plateFields.get(cacheKey);
  if (field) return field;
  field = new Int32Array(world.n).fill(-1);
  const heap = makeHeap();
  const tiles = world.plateTilesByColor.get(color);
  if (tiles) for (const k of tiles) { field[k] = 0; heapPush(heap, 0, k); }
  while (heap.length) {
    const cur = heapPop(heap);
    const base = field[cur];
    for (const nk of world.neighbors(cur)) {
      if (nk < 0 || world.boxBlocked[nk]) continue;
      const g = world.gateAt.get(nk);
      const cost = base + 1 + (g && !pushDown.has(gateLock(g)) && gateLock(g) !== LOCK_NONE ? UNHELD_GATE_COST : 0);
      if (field[nk] >= 0 && field[nk] <= cost) continue;
      field[nk] = cost;
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
function successors(world, state, region, allowPush, onlyId = null) {
  const out = [];
  if (!allowPush) return out;
  for (const [pos, id] of state.pushables) {
    if (onlyId != null && id !== onlyId) continue; // single-box sub-solve
    const onBox = region.has(pos);
    // Plate colors held by the OTHER boxes — the moving box's own
    // contribution is re-derived per step from its current tile.
    const others = new Set();
    for (const k of state.pushables.keys()) {
      if (k === pos) continue;
      const c = world.plateColorAt.get(k);
      if (c != null) others.add(c);
    }
    for (const dir of DIRS) {
      const behind = world.step(pos, -dir.dx, -dir.dy);
      let cur = pos;
      let playerTile = behind >= 0 && region.has(behind) ? behind : pos;
      if (playerTile === pos && !onBox) continue;
      for (;;) {
        const curTile = cur;
        const pd = (color) => others.has(color) || world.plateColorAt.get(curTile) === color;
        let ok = boxCanSlide(world, state.pushables, cur, dir, playerTile, pd);
        // First step may be possible from the other origin (gate state
        // differs when the origin tile is a plate).
        if (!ok && cur === pos && playerTile === behind && onBox) {
          playerTile = pos;
          ok = boxCanSlide(world, state.pushables, cur, dir, pos, pd);
        }
        if (!ok) break;
        const next = world.step(cur, dir.dx, dir.dy);
        const pushables = new Map(state.pushables);
        pushables.delete(pos);
        pushables.set(next, id);
        out.push({
          state: { pushables, player: cur },
          move: { push: id, dir: dir.name, blockTo: world.tileOf(next), playerTo: world.tileOf(cur) },
        });
        playerTile = cur;
        cur = next;
      }
    }
  }
  return out;
}

// Can the box at `from` slide one tile along `dir` while the player
// stands on `playerTile`? Mirrors pushOneTile: terrain-walkable (boxes
// don't get the player's teleporter override), no rigid entity, no other
// box, and any gate on the target read with the player's weight applied
// (the engine validates the slide while the player still stands there).
function boxCanSlide(world, boxes, from, dir, playerTile, plateDown) {
  const target = world.step(from, dir.dx, dir.dy);
  if (target < 0) return false;
  if (world.boxBlocked[target]) return false;
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
// { tiles, has, rep, plateDown, pushDown, goalD, gateStar, goalHit }.
// has() reads the shared stamp scratch and is only valid until the NEXT
// flood of this solve — see the note in search().
function reachableRegion(world, state) {
  // Colors held down by a pushable resting on a plate of that color.
  const pushDown = new Set();
  for (const [color, tiles] of world.plateTilesByColor) {
    for (const k of state.pushables.keys()) {
      if (tiles.has(k)) { pushDown.add(color); break; }
    }
  }
  const plateDown = makePlateDown(world, pushDown);
  const { tiles, stamp, goalD, gateStar, goalHit } = flood(world, state.player, state.pushables, plateDown);
  // Directed reach: same min tile can front different reachable sets, so
  // the canonical key carries the size too.
  let rep = state.player;
  for (const k of tiles) if (k < rep) rep = k;
  const has = (i) => world.seenStamp[i] === stamp;
  return { tiles, has, rep: `${rep}#${tiles.length}`, plateDown, pushDown, goalD, gateStar, goalHit };
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
  const goalSet = world.goalSet;
  let bestD = goalD ? (goalD[seed] >= 0 ? goalD[seed] : Infinity) : Infinity;
  let goalHit = goalSet?.has(seed) ? seed : -1;
  let gateStar = null;
  let gateStarD = Infinity;
  const stamp = ++world.stamp;
  const seen = world.seenStamp;
  seen[seed] = stamp;
  const tiles = [seed]; // doubles as the work queue (head pointer below)
  let head = 0;
  while (head < tiles.length) {
    const cur = tiles[head++];
    const onBox = boxes.has(cur);
    for (const dir of DIRS) {
      const nk = world.step(cur, dir.dx, dir.dy);
      if (nk < 0 || seen[nk] === stamp) continue;
      if (onBox && boxCanSlide(world, boxes, cur, dir, cur, plateDown)) continue;
      if (world.baseBlocked[nk]) continue;
      if (boxes.has(nk)) {
        if (boxCanSlide(world, boxes, nk, dir, cur, plateDown)) continue;
      } else {
        const g = world.gateAt.get(nk);
        if (g && !gateOpen(world, g, withSelfWeight(world, plateDown, cur))) continue;
      }
      if (goalD) {
        const d = goalD[nk];
        if (d >= 0 && d < bestD) bestD = d;
      }
      if (goalHit < 0 && goalSet?.has(nk)) goalHit = nk;
      seen[nk] = stamp;
      tiles.push(nk);
    }
  }
  // Closed boundary gate nearest the goal — re-walk the region rim. Done
  // as a second pass so a gate first probed from a far tile but also
  // adjacent to a near one isn't mis-ranked.
  if (goalD) {
    for (const cur of tiles) {
      for (const dir of DIRS) {
        const nk = world.step(cur, dir.dx, dir.dy);
        if (nk < 0 || seen[nk] === stamp || boxes.has(nk)) continue;
        const g = world.gateAt.get(nk);
        if (!g || gateOpen(world, g, withSelfWeight(world, plateDown, cur))) continue;
        const d = goalD[nk];
        if (d >= 0 && d < gateStarD) {
          gateStarD = d;
          gateStar = { color: gateLock(g), kind: g.kind };
        }
      }
    }
  }
  return { tiles, stamp, goalD: bestD, gateStar, goalHit };
}

// A Gate is open while its color plate is down; an InverseGate while it's
// up. Lock-None gates are always open; Permanent never.
function gateOpen(world, gate, plateDown) {
  const lock = gateLock(gate);
  if (lock === LOCK_PERMANENT) return false;
  if (gate.kind === "Gate") return lock === LOCK_NONE || !!plateDown(lock);
  return lock === LOCK_NONE || !plateDown(lock);
}

// Engine-true tile-by-tile walk path from `startTile` to the nearest goal,
// over the EXACT same edges as flood() — directed self-weight (step from a
// plate into its adjacent gate), box bridges (a box on a closed gate), and
// share-tile climbs of pinned boxes. The in-page bot replays this for its
// puzzle navigation; a plain BFS over live collision can't see those edges,
// so it gives up at gates the engine would actually open. Returns an array of
// {x,y} (inclusive of both ends) or null. Pushables frozen at `opts.
// pushableStarts` (their live tiles) — walking never moves a box.
export function walkPath(model, startTile, goalTiles, opts = {}) {
  const world = prepare(model, opts);
  const goals = new Set(
    (Array.isArray(goalTiles) ? goalTiles : [goalTiles])
      .map((t) => world.idx(t.x, t.y))
      .filter((i) => i >= 0),
  );
  const start = world.idx(startTile.x | 0, startTile.y | 0);
  if (start < 0 || goals.size === 0) return null;
  if (goals.has(start)) return [world.tileOf(start)];
  const boxes = world.pushableStart;
  const pushDown = new Set();
  for (const [color, tiles] of world.plateTilesByColor) {
    for (const k of boxes.keys()) { if (tiles.has(k)) { pushDown.add(color); break; } }
  }
  const plateDown = makePlateDown(world, pushDown);
  const prev = new Int32Array(world.n).fill(-1);
  prev[start] = start; // self-parent marks "visited" for the seed
  const q = [start];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const onBox = boxes.has(cur);
    for (const dir of DIRS) {
      const nk = world.step(cur, dir.dx, dir.dy);
      if (nk < 0 || prev[nk] >= 0) continue;
      if (onBox && boxCanSlide(world, boxes, cur, dir, cur, plateDown)) continue;
      if (world.baseBlocked[nk]) continue;
      if (boxes.has(nk)) {
        if (boxCanSlide(world, boxes, nk, dir, cur, plateDown)) continue;
      } else {
        const g = world.gateAt.get(nk);
        if (g && !gateOpen(world, g, withSelfWeight(world, plateDown, cur))) continue;
      }
      prev[nk] = cur;
      if (goals.has(nk)) {
        const path = [];
        for (let k = nk; ; k = prev[k]) {
          path.unshift(world.tileOf(k));
          if (prev[k] === k || prev[k] < 0) break;
        }
        return path;
      }
      q.push(nk);
    }
  }
  return null;
}

// Tiles the player can stand on by plain walking from `startTile`, given
// the current pushable layout and plate-controlled gates. No pushes — the
// cheap question the route planner asks every drain iteration. Returns a
// Set of "x,y".
export function reachableTiles(model, startTile, opts = {}) {
  const world = prepare(model, opts);
  const start = world.idx(startTile.x | 0, startTile.y | 0);
  if (start < 0) return new Set();
  const state = { pushables: world.pushableStart, player: start };
  const region = reachableRegion(world, state);
  const out = new Set();
  for (const i of region.tiles) out.add(tileKey(i % world.cols, (i / world.cols) | 0));
  return out;
}

// --- setup + helpers -----------------------------------------------------

// Builds the int-packed solve world from a (string-keyed) zone model.
// Tile int = y*cols+x; step()/idx() return -1 for out-of-bounds so callers
// have a single guard.
function prepare(model, opts) {
  const cols = model.cols;
  const rows = model.rows;
  const n = cols * rows;
  const parse = (k) => {
    const i = k.indexOf(",");
    const x = parseInt(k.slice(0, i), 10);
    const y = parseInt(k.slice(i + 1), 10);
    return y * cols + x;
  };

  const baseBlocked = new Uint8Array(n);
  for (const k of model.staticBlocked) baseBlocked[parse(k)] = 1;
  for (const k of model.lockedTeleporterTiles) baseBlocked[parse(k)] = 1;
  const entityBlocked = [];
  for (const k of model.rigidStaticTiles) entityBlocked.push(parse(k));
  for (const c of model.conditionalRigid) {
    if (!shouldBeVisible(c.entity)) continue;
    for (const k of c.tiles) entityBlocked.push(parse(k));
  }
  const enterableTeleporters = [...model.enterableTeleporterTiles].map(parse);
  const enterableSet = new Set(enterableTeleporters);
  for (const i of entityBlocked) {
    if (!enterableSet.has(i)) baseBlocked[i] = 1;
  }
  // Boxes obey raw terrain + entity collision (pushOneTile: isWalkable +
  // isEntityBlocked) — no teleporter override, so interior exit doors on
  // unwalkable tiles stay box-proof.
  const boxBlocked = Uint8Array.from(baseBlocked);
  // Enterable teleporters override terrain AND entity collision for the
  // PLAYER (player.js::canEnter) — interior exit doors sit on unwalkable
  // tiles. The in-page bot passes avoidTeleporters so its puzzle solves/walks
  // never step onto one (which would warp it out of the zone mid-puzzle); the
  // route planner leaves them walkable (default) since travel IS its goal.
  for (const i of enterableTeleporters) baseBlocked[i] = opts.avoidTeleporters ? 1 : 0;
  // Explosive barrels die to bullets/melee (combat.js) — passable for the
  // solver by default (the player clears the barrel before walking/pushing
  // through). The in-page bot has no practical way to destroy a 100-HP barrel
  // (a kunai chips ~1, and it starts swordless), so it passes barrelsBlock to
  // treat them as solid walls and route around them instead.
  if (!opts.barrelsBlock) {
    for (const k of model.destructibleTiles) {
      const i = parse(k);
      baseBlocked[i] = 0;
      boxBlocked[i] = 0;
    }
  }

  const gateAt = new Map();
  for (const g of model.gates) for (const k of g.tiles) gateAt.set(parse(k), g);

  const plateTilesByColor = new Map();
  const plateColorAt = new Map();
  for (const p of model.plates) {
    if (!plateTilesByColor.has(p.color)) plateTilesByColor.set(p.color, new Set());
    const set = plateTilesByColor.get(p.color);
    for (const k of p.tiles) {
      const i = parse(k);
      set.add(i);
      plateColorAt.set(i, p.color);
    }
  }

  const idx = (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? -1 : y * cols + x);
  const pushableStart = new Map();
  if (opts.pushableStarts) {
    for (const [id, t] of opts.pushableStarts) pushableStart.set(idx(t.x, t.y), id);
  } else {
    for (const p of model.pushables) pushableStart.set(idx(p.start.x, p.start.y), p.entityId);
  }

  return {
    model,
    cols,
    rows,
    n,
    baseBlocked,
    boxBlocked,
    gateAt,
    plateTilesByColor,
    plateColorAt,
    pushableStart,
    plateFields: new Map(),
    seenStamp: new Int32Array(n),
    stamp: 0,
    goalD: null,
    goalSet: null,
    idx,
    tileOf: (i) => ({ x: i % cols, y: (i / cols) | 0 }),
    // One tile over (dx,dy), or -1 when that walks off the grid.
    step: (i, dx, dy) => {
      const x = (i % cols) + dx;
      const y = ((i / cols) | 0) + dy;
      return x < 0 || y < 0 || x >= cols || y >= rows ? -1 : y * cols + x;
    },
    // Cardinal neighbors (array with -1 for off-grid) — used by the field
    // builders; the flood inlines step() per direction instead.
    neighbors: (i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return [
        y > 0 ? i - cols : -1,
        y < rows - 1 ? i + cols : -1,
        x > 0 ? i - 1 : -1,
        x < cols - 1 ? i + 1 : -1,
      ];
    },
  };
}

function macroKey(state, region) {
  return [...state.pushables.keys()].sort((a, b) => a - b).join(";") + "|" + region.rep;
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

function done(world, moves, goalTile) {
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
  const layout = new Map(world.pushableStart); // tile int -> id
  for (const m of moves) {
    if (m.push == null) continue;
    // find current tile of this id
    let from = null;
    for (const [k, id] of layout) if (id === m.push) { from = k; break; }
    if (from == null) continue;
    layout.delete(from);
    layout.set(world.idx(m.blockTo.x, m.blockTo.y), m.push);
  }
  return new Set(layout.keys());
}

function fail(reason, explored) {
  return { reachable: false, reason, statesExplored: explored };
}
