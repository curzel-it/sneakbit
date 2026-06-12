// Zone connectivity graph: one node per discovered zone, one edge per
// wired teleporter. Edges carry the teleporter's lock — a non-None lock
// makes the edge non-traversable (teleporter locks are never spent by
// keys; see zone.js::isTeleporterLocked). Whether the teleporter's tile
// is *reachable* inside the source zone under the current sim state is
// the route planner's concern, not the graph's.
//
// Arrival resolution mirrors main.js::maybeTeleport + transitions.js::
// resolveSpawn/stepOutOf: a non-zero destination y is sprite-top space
// and lands the player at y+1 (feet); (0,0) means "step out of the
// teleporter in the destination zone that points back at us".

import { buildZoneModel, blockedTiles, tileKey } from "./worldModel.js";
import { LOCK_NONE } from "../locks.js";

const DIR_OFFSET = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

// world = discoverWorld(...) result. Builds models for every zone and the
// edge list. Returns { models: Map<id, ZoneModel>, edges: [...] }.
export function buildZoneGraph(world) {
  const models = new Map();
  for (const [id, raw] of world.zones) models.set(id, buildZoneModel(raw));

  const edges = [];
  for (const [id, model] of models) {
    for (const t of model.teleporters) {
      const destZone = t.dest?.zone;
      if (!destZone || !models.has(destZone)) continue;
      edges.push({
        from: id,
        to: destZone,
        teleporterEntityId: t.entityId,
        tiles: t.tiles,
        lock: t.lock,
        dest: t.dest,
        frame: t.frame,
      });
    }
  }
  return { models, edges };
}

export function edgeTraversable(edge) {
  return edge.lock === LOCK_NONE;
}

// Feet tile the player lands on when taking `edge`. `blockedSetFor` maps
// a destination ZoneModel to its current blocked-tile Set — defaults to a
// virgin-state set (all plates up, pushables at their starts), which is
// what graph-level tests want; the route planner passes live state.
export function resolveArrival(graph, edge, blockedSetFor = defaultBlockedSet) {
  const destModel = graph.models.get(edge.to);
  if (!destModel) return null;
  const ox = edge.dest?.x ?? 0;
  const oy = edge.dest?.y ?? 0;
  if (ox === 0 && oy === 0) {
    const back = destModel.teleporters.find((t) => t.dest?.zone === edge.from)
      ?? destModel.teleporters[0];
    if (!back) {
      return { x: Math.floor(destModel.cols / 2), y: Math.floor(destModel.rows / 2) };
    }
    return stepOutOf(destModel, back.frame, edge.dest?.direction, blockedSetFor(destModel));
  }
  return {
    x: clamp(ox, 0, destModel.cols - 1),
    y: clamp(oy + 1, 0, destModel.rows - 1),
  };
}

// Zones reachable from startId over traversable edges (optionally further
// filtered). Returns a Set of zone ids including the start.
export function reachableZones(graph, startId, edgeFilter = () => true) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    for (const e of graph.edges) {
      if (e.from !== id || seen.has(e.to)) continue;
      if (!edgeTraversable(e) || !edgeFilter(e)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return seen;
}

// Mirrors transitions.js::stepOutOf exactly, including the corner quirk
// for multi-tile frames (positive offsets step from the bottom-right
// corner) and the final fall-back onto the teleporter tile itself.
function stepOutOf(model, frame, direction, blocked) {
  const preferred = direction && direction !== "None"
    ? String(direction).toLowerCase()
    : "down";
  const order = [preferred, "down", "up", "left", "right"];
  const seen = new Set();
  for (const dir of order) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const off = DIR_OFFSET[dir];
    if (!off) continue;
    const tx = (off[0] >= 0 ? frame.x + frame.w - 1 : frame.x) + off[0];
    const ty = (off[1] >= 0 ? frame.y + frame.h - 1 : frame.y) + off[1];
    if (tx < 0 || ty < 0 || tx >= model.cols || ty >= model.rows) continue;
    if (blocked.has(tileKey(tx, ty))) continue;
    return { x: tx, y: ty };
  }
  return { x: frame.x, y: frame.y };
}

function defaultBlockedSet(model) {
  return blockedTiles(model, {
    plateDown: () => false,
    pushableTiles: new Set(model.pushables.map((p) => tileKey(p.start.x, p.start.y))),
  });
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
