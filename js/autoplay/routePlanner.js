// Whole-game completionist route: a forward simulation of playing from a
// fresh save — collect every pickup, exhaust every dialogue, trigger
// every cutscene, spend keys only when no plate solution exists — until
// nothing actionable remains anywhere. Storage/inventory state lives in
// the REAL js/storage.js + js/inventory.js modules (the same substrate
// the engine plays on), so condition semantics can't drift.
//
// The sim mirrors engine zone-entry semantics: pushables reset to their
// JSON starts (zone.js clones from raw on every build), and the zone's
// own plates immediately rewrite their global pressure_plate_down flags
// from current occupancy (puzzles.js ticks every frame) — entering a
// zone whose red plate is unweighted clears the global red flag.

import { tileKey, invalidatePassableCache } from "./worldModel.js";
import { buildZoneGraph, edgeTraversable, resolveArrival } from "./zoneGraph.js";
import { liveObjectives } from "./objectiveCatalog.js";
import { solveToTiles, reachableTiles } from "./puzzleSolver.js";
import { exhaustEntityDialogue } from "./dialogueSim.js";
import { resolveEntityDialogue, dialogueLines } from "../dialogue.js";
import { getValue, setValue, _resetStorageForTesting } from "../storage.js";
import { addAmmo, clearInventory } from "../inventory.js";
import { addCoins } from "../wallet.js";
import { getSpecies } from "../species.js";
import { setPressurePlateDown } from "../locks.js";
import { STARTING_ZONE_ID, STARTING_SPAWN } from "../constants.js";

const MAX_GLOBAL_PASSES = 64;

export function resetSimState() {
  _resetStorageForTesting();
  for (let p = 0; p < 4; p++) clearInventory(p);
}

// world = discoverWorld(...) result.
// Returns { steps, visitedZones, collected, linesRead, keysLedger,
//           finaleReached, unreachable }.
export function planRoute(world, opts = {}) {
  const graph = buildZoneGraph(world);
  const sim = {
    graph,
    zoneId: opts.startZone ?? STARTING_ZONE_ID,
    tile: { ...(opts.startTile ?? STARTING_SPAWN) },
    runtime: new Map(), // zoneId -> { pushables: Map<id,{x,y}>, extraTalkables: [] }
    steps: [],
    visitedZones: new Set(),
    collected: new Set(),
    linesRead: new Set(),
    keysLedger: [],
    unreachable: [],
  };

  enterZone(sim, sim.zoneId, sim.tile);

  // Fixed visit order: BFS over traversable edges from the start. Every
  // zone is reachable this way (teleporter edges are never key-gated), so
  // a sweep can touch the whole world; key dependencies are resolved by
  // re-sweeping until a full pass collects nothing new.
  const order = bfsZoneOrder(graph, sim.zoneId);
  let pass = 0;
  let progressed = true;
  while (progressed && pass < MAX_GLOBAL_PASSES) {
    pass++;
    progressed = drainZone(sim); // current zone first (no travel needed)
    for (const zoneId of order) {
      if (zoneId === sim.zoneId) continue;
      if (!travelTo(sim, zoneId)) continue; // unreachable in practice right now
      if (drainZone(sim)) progressed = true;
    }
  }

  for (const [zoneId, model] of graph.models) {
    const rt = runtimeFor(sim, zoneId);
    for (const o of mergedObjectives(model, rt)) {
      sim.unreachable.push({
        kind: o.kind,
        zone: zoneId,
        entityId: o.entityId ?? null,
        key: o.key ?? null,
      });
    }
  }

  return {
    steps: sim.steps,
    visitedZones: sim.visitedZones,
    collected: sim.collected,
    linesRead: sim.linesRead,
    keysLedger: sim.keysLedger,
    finaleReached: getValue("demon_lord_defeat") === 1,
    unreachable: sim.unreachable,
  };
}

// --- zone lifecycle ------------------------------------------------------

function runtimeFor(sim, zoneId) {
  if (!sim.runtime.has(zoneId)) {
    sim.runtime.set(zoneId, { pushables: null, extraTalkables: [] });
  }
  return sim.runtime.get(zoneId);
}

function enterZone(sim, zoneId, tile) {
  sim.zoneId = zoneId;
  sim.tile = { x: tile.x | 0, y: tile.y | 0 };
  sim.visitedZones.add(zoneId);
  setValue(`did_visit.${zoneId}`, 1);
  const model = sim.graph.models.get(zoneId);
  const rt = runtimeFor(sim, zoneId);
  // Pushables reset to JSON starts on every entry (engine rebuilds the
  // zone from raw).
  rt.pushables = new Map(model.pushables.map((p) => [p.entityId, { ...p.start }]));
  syncPlateFlags(sim, model, rt);
  invalidatePassableCache(model);
}

// Rewrite this zone's plate colors from current occupancy — the sim
// equivalent of the first tickPuzzles after entry. Colors with no plate
// in this zone keep their global flag (cross-zone persistence).
function syncPlateFlags(sim, model, rt) {
  const occupied = new Set(
    [...rt.pushables.values()].map((p) => tileKey(p.x, p.y)),
  );
  occupied.add(tileKey(sim.tile.x, sim.tile.y));
  const colorsHere = new Set(model.plates.map((p) => p.color));
  for (const color of colorsHere) {
    let down = false;
    for (const plate of model.plates) {
      if (plate.color !== color) continue;
      if (plate.tiles.some((k) => occupied.has(k))) { down = true; break; }
    }
    setPressurePlateDown(color, down);
  }
}

// --- objective draining ----------------------------------------------------

function mergedObjectives(model, rt) {
  const out = liveObjectives(model);
  for (const e of rt.extraTalkables) {
    if (getValue(`item_collected.${e.id}`) === 1) continue;
    const live = out.find((o) => o.entityId === e.id);
    if (!live) {
      out.push({ kind: "talk", zone: model.id, entityId: e.id ?? null, tiles: [], ref: { entity: e }, auto: true });
    }
  }
  return out;
}

// Work through this zone's objectives until none is solvable from the
// current state. Returns true if anything was accomplished.
//
// Fast path: one walk-region flood per iteration covers every objective
// reachable on foot (the common case). Only when nothing is walkable do
// we fall back to the full push/key solver for the remaining objectives.
function drainZone(sim) {
  const model = sim.graph.models.get(sim.zoneId);
  const rt = runtimeFor(sim, sim.zoneId);
  let didAnything = false;

  while (true) {
    const objectives = mergedObjectives(model, rt);
    if (objectives.length === 0) break;

    let pick = pickWalkable(sim, model, rt, objectives);
    if (!pick) pick = pickSolvable(sim, model, rt, objectives);
    if (!pick) break;

    executeSolve(sim, model, rt, pick.solve);
    applyObjective(sim, model, rt, pick.objective);
    syncPlateFlags(sim, model, rt);
    invalidatePassableCache(model);
    didAnything = true;
  }
  return didAnything;
}

// Nearest objective reachable on foot right now (no pushes, no keys).
function pickWalkable(sim, model, rt, objectives) {
  const region = reachableTiles(model, sim.tile, { pushableStarts: rt.pushables });
  let best = null;
  let bestDist = Infinity;
  for (const o of objectives) {
    if (o.auto) return { objective: o, solve: { actions: [] } };
    if (!o.tiles?.length) continue;
    for (const t of o.tiles) {
      if (!region.has(tileKey(t.x, t.y))) continue;
      const d = Math.abs(t.x - sim.tile.x) + Math.abs(t.y - sim.tile.y);
      if (d < bestDist) {
        bestDist = d;
        best = { objective: o, solve: { actions: [{ walkTo: { x: t.x, y: t.y } }] } };
      }
    }
  }
  return best;
}

// First objective the full solver can reach via pushing or a held key.
function pickSolvable(sim, model, rt, objectives) {
  for (const o of objectives) {
    if (o.auto || !o.tiles?.length) continue;
    const solve = solveToTiles(model, sim.tile, o.tiles, { pushableStarts: rt.pushables });
    if (solve.reachable) return { objective: o, solve };
  }
  return null;
}

function executeSolve(sim, model, rt, solve) {
  for (const a of solve.actions) {
    if (a.walkTo) {
      sim.tile = { ...a.walkTo };
    } else if (a.push != null) {
      rt.pushables.set(a.push, { ...a.blockTo });
      sim.tile = { ...a.playerTo }; // player ends on the block's old tile
      sim.steps.push({ kind: "push", zone: sim.zoneId, entityId: a.push, to: a.blockTo });
    }
  }
}

function applyObjective(sim, model, rt, o) {
  if (o.kind === "pickup") {
    collectPickup(sim, o);
  } else if (o.kind === "hint") {
    const h = o.ref;
    if (h.consumable) {
      if (h.entityId != null) setValue(`item_collected.${h.entityId}`, 1);
    } else {
      markHintRead(h.entity);
    }
    sim.steps.push({ kind: "hint", zone: sim.zoneId, entityId: o.entityId });
  } else if (o.kind === "talk") {
    const entity = o.ref.entity;
    const r = exhaustEntityDialogue(entity);
    for (const text of r.linesRead) sim.linesRead.add(text);
    sim.steps.push({ kind: "talk", zone: sim.zoneId, entityId: o.entityId, lines: r.linesRead.length });
  } else if (o.kind === "cutscene") {
    setValue(o.key, 1);
    sim.steps.push({ kind: "cutscene", zone: sim.zoneId, key: o.key });
    // on_end spawns (story dialogues) — play them out immediately.
    for (const e of o.ref.onEnd ?? []) {
      if ((e.dialogues ?? []).length > 0) rt.extraTalkables.push(e);
    }
  }
}

function collectPickup(sim, o) {
  if (o.entityId != null) {
    setValue(`item_collected.${o.entityId}`, 1);
    sim.collected.add(o.entityId);
  }
  const sp = getSpecies(o.speciesId);
  if (!sp) return;
  if (sp.entity_type === "WeaponMelee" || sp.entity_type === "WeaponRanged") {
    // Equipment, not inventory — irrelevant to route feasibility.
  } else if (sp.bundle_contents?.length) {
    const counts = new Map();
    for (const cid of sp.bundle_contents) counts.set(cid, (counts.get(cid) || 0) + 1);
    for (const [cid, n] of counts) addAmmo(cid, n, 0);
  } else if (o.speciesId === 2010) {
    addCoins(1);
  } else {
    addAmmo(o.speciesId, 1, 0);
  }
  sim.steps.push({ kind: "pickup", zone: sim.zoneId, entityId: o.entityId, speciesId: o.speciesId });
}

// Mirror pickups.js::triggerHint's persistent read flag (same localized
// text derivation as objectiveCatalog's hintAlreadyRead).
function markHintRead(entity) {
  const d = resolveEntityDialogue(entity);
  const text = dialogueLines(d).join("\n");
  if (text) setValue(`hint.read.${text}`, 1);
}

// --- travel ----------------------------------------------------------------

// Fixed sweep order: zones in BFS distance order from the start over
// traversable edges.
function bfsZoneOrder(graph, startId) {
  const order = [];
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of graph.edges) {
      if (e.from !== id || seen.has(e.to) || !edgeTraversable(e)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return order;
}

// Walk the sim from its current zone to `targetZone` along a shortest
// graph path, solving and executing each teleporter hop from the live
// position. Returns true on arrival, false if some hop can't be solved
// right now (the target is skipped this sweep and retried next one).
//
// The first hop must depart from where the player actually STANDS — a
// story event can wall the player into a pocket whose only way out is
// one specific teleporter (e.g. 1011's priestess antechamber: the quest
// spawns her across the corridor and the stairs down are the exit). So
// shortest paths whose first edge is walk-reachable right now are
// preferred; if none exists, fall back to any path and let the full
// solver try the first hop (it may need pushes).
function travelTo(sim, targetZone) {
  if (sim.zoneId === targetZone) return true;
  const model = sim.graph.models.get(sim.zoneId);
  const rt = runtimeFor(sim, sim.zoneId);
  const region = reachableTiles(model, sim.tile, { pushableStarts: rt.pushables });
  const firstHopOk = (e) => e.tiles.some((t) => region.has(tileKey(t.x, t.y)));
  const path = graphPath(sim.graph, sim.zoneId, targetZone, firstHopOk)
    ?? graphPath(sim.graph, sim.zoneId, targetZone, null);
  if (path) {
    let ok = true;
    for (const edge of path) {
      if (!traverseEdge(sim, edge)) { ok = false; break; }
    }
    if (ok) return true;
    if (sim.zoneId === targetZone) return true;
  }
  // The zone-granular path failed mid-journey — usually because some hop
  // ARRIVES in a pocket the next hop can't leave (1011's stairs loop back
  // into the priestess antechamber). Re-plan over (zone, arrival tile)
  // nodes so the path only uses hops that are walkable from where each
  // teleport actually lands.
  return travelToByArrival(sim, targetZone);
}

// Position-aware travel: BFS over (zone, tile) nodes where a hop is taken
// only if its teleporter is walk-reachable from the node's tile, and the
// next node is the hop's RESOLVED arrival. Slower than the zone BFS (one
// flood per node) — used only as its fallback.
function travelToByArrival(sim, targetZone) {
  const graph = sim.graph;
  const nodeKey = (zone, tile) => `${zone}|${tile.x},${tile.y}`;
  const start = nodeKey(sim.zoneId, sim.tile);
  const prev = new Map([[start, null]]); // nodeKey -> { fromKey, edge }
  let frontier = [{ zone: sim.zoneId, tile: sim.tile, key: start }];
  let goalKey = null;
  while (frontier.length && !goalKey) {
    const next = [];
    for (const node of frontier) {
      const model = graph.models.get(node.zone);
      const rt = runtimeFor(sim, node.zone);
      const pushables = node.zone === sim.zoneId && rt.pushables
        ? rt.pushables
        : new Map(model.pushables.map((p) => [p.entityId, { ...p.start }]));
      const region = reachableTiles(model, node.tile, { pushableStarts: pushables });
      for (const e of graph.edges) {
        if (e.from !== node.zone || !edgeTraversable(e)) continue;
        if (!e.tiles.some((t) => region.has(tileKey(t.x, t.y)))) continue;
        const arrival = resolveArrival(graph, e);
        if (!arrival) continue;
        const key = nodeKey(e.to, arrival);
        if (prev.has(key)) continue;
        prev.set(key, { fromKey: node.key, edge: e });
        if (e.to === targetZone) { goalKey = key; break; }
        next.push({ zone: e.to, tile: arrival, key });
      }
      if (goalKey) break;
    }
    frontier = next;
  }
  if (!goalKey) return false;
  const hops = [];
  for (let k = goalKey; ; ) {
    const rec = prev.get(k);
    if (!rec) break;
    hops.unshift(rec.edge);
    k = rec.fromKey;
  }
  for (const edge of hops) {
    if (!traverseEdge(sim, edge)) return false;
  }
  return true;
}

// Shortest sequence of traversable edges from `fromZone` to `toZone`.
// `firstHopOk` (optional) filters which edges may leave the start zone as
// the FIRST hop. The start zone itself stays revisitable — escaping a
// pocket can mean leaving through one teleporter and re-entering the same
// zone elsewhere — so the search is seeded with the allowed first edges
// rather than with the start zone.
function graphPath(graph, fromZone, toZone, firstHopOk) {
  const prev = new Map(); // zoneId -> edge taken to reach it
  const seeds = new Set();
  const queue = [];
  for (const e of graph.edges) {
    if (e.from !== fromZone || !edgeTraversable(e)) continue;
    if (firstHopOk && !firstHopOk(e)) continue;
    if (prev.has(e.to)) continue;
    prev.set(e.to, e);
    seeds.add(e);
    queue.push(e.to);
  }
  while (queue.length) {
    const id = queue.shift();
    if (id === toZone) break;
    for (const e of graph.edges) {
      if (e.from !== id || prev.has(e.to) || !edgeTraversable(e)) continue;
      prev.set(e.to, e);
      queue.push(e.to);
    }
  }
  if (!prev.has(toZone)) return null;
  const path = [];
  for (let cur = toZone; ; cur = path[0].from) {
    const e = prev.get(cur);
    path.unshift(e);
    if (seeds.has(e)) break;
  }
  return path;
}

// Solve+execute a single teleporter hop from the current position.
function traverseEdge(sim, edge) {
  const model = sim.graph.models.get(edge.from);
  const rt = runtimeFor(sim, edge.from);
  const solve = solveToTiles(model, sim.tile, edge.tiles, { pushableStarts: rt.pushables });
  if (!solve.reachable) {
    if (globalThis.process?.env?.ROUTE_DEBUG) {
      console.error(`HOP FAIL ${edge.from}->${edge.to} from ${sim.tile.x},${sim.tile.y}: ${solve.reason} (${solve.statesExplored})`);
    }
    return false;
  }
  executeSolve(sim, model, rt, solve);
  const arrival = resolveArrival(sim.graph, edge);
  sim.steps.push({ kind: "travel", from: edge.from, to: edge.to });
  enterZone(sim, edge.to, arrival);
  return true;
}
