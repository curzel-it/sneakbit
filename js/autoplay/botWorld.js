// World knowledge for the autoplay bot. Prefetches every zone JSON (BFS
// over teleporter destinations, exactly like worldIndex does), builds the
// analysis models + connectivity graph ONCE, and exposes them plus the
// fixed sweep order the orchestrator tours.
//
// The phase-1 modules are DOM/fs-free by design, so they import straight
// into the browser; the only thing they need is a synchronous raw-zone
// loader, which we satisfy by prefetching into a Map first.

import { loadZone } from "../data.js";
import { discoverWorld, zoneDestinations } from "./worldIndex.js";
import { buildZoneGraph, edgeTraversable } from "./zoneGraph.js";

const START_ZONE = 1001;

// Prefetch all reachable zones into a Map<id, rawJson>. Async BFS over
// destinations (loadZone is cached, so re-asking is cheap).
async function prefetchZones() {
  const zones = new Map();
  const seen = new Set([START_ZONE]);
  let frontier = [START_ZONE];
  while (frontier.length) {
    const raws = await Promise.all(frontier.map((id) => loadZone(id).catch(() => null)));
    const next = [];
    for (let i = 0; i < frontier.length; i++) {
      const raw = raws[i];
      if (!raw) continue;
      zones.set(frontier[i], raw);
      for (const dest of zoneDestinations(raw)) {
        if (seen.has(dest)) continue;
        seen.add(dest);
        next.push(dest);
      }
    }
    frontier = next;
  }
  return zones;
}

// BFS visit order over traversable edges from the start — coherent tours,
// no teleport ping-pong (mirrors routePlanner's bfsZoneOrder).
function sweepOrder(graph, startId) {
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

// Build the bot's world once. Returns { graph, order, modelFor }.
export async function loadBotWorld() {
  const zones = await prefetchZones();
  const world = discoverWorld((id) => zones.get(id) ?? null, START_ZONE);
  const graph = buildZoneGraph(world);
  const order = sweepOrder(graph, START_ZONE);
  return {
    graph,
    order,
    modelFor: (id) => graph.models.get(id) ?? null,
    zoneCount: graph.models.size,
  };
}
