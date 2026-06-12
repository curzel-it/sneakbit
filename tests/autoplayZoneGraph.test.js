// Zone graph: teleporter edges, lock annotations, and arrival-tile
// resolution. The world must be fully traversable over UNLOCKED edges —
// Permanent one-way doors always pair with an unlocked way in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { discoverWorld } from "../js/autoplay/worldIndex.js";
import {
  buildZoneGraph,
  edgeTraversable,
  resolveArrival,
  reachableZones,
} from "../js/autoplay/zoneGraph.js";
import { tileKey, blockedTiles } from "../js/autoplay/worldModel.js";
import { _resetStorageForTesting } from "../js/storage.js";
import { LOCK_NONE, LOCK_PERMANENT } from "../js/locks.js";

_resetStorageForTesting();
const world = discoverWorld(loadWorldFromDisk().loadRawZone);
const graph = buildZoneGraph(world);

test("the maze antechamber links to the finale zone, unlocked", () => {
  const edge = graph.edges.find((e) => e.from === 1010 && e.to === 1017);
  assert.ok(edge, "no 1010 -> 1017 edge");
  assert.equal(edge.lock, LOCK_NONE);
  assert.ok(edgeTraversable(edge));
});

test("every zone is reachable from 1001 over unlocked edges alone", () => {
  const reached = reachableZones(graph, 1001);
  const missing = [...graph.models.keys()].filter((id) => !reached.has(id));
  assert.deepEqual(missing, [], `zones only reachable through locked doors: ${missing}`);
});

test("Permanent one-way doors are non-traversable but never strand a zone", () => {
  const permanent = graph.edges.filter((e) => e.lock === LOCK_PERMANENT);
  assert.ok(permanent.length > 0, "expected at least one Permanent one-way door in the data");
  for (const e of permanent) {
    assert.ok(!edgeTraversable(e));
    // The destination must still be enterable some unlocked way.
    const reached = reachableZones(graph, 1001);
    assert.ok(reached.has(e.to), `zone ${e.to} only enterable via Permanent door from ${e.from}`);
  }
});

test("non-zero destinations land at sprite-top + 1 (feet space)", () => {
  const edge = graph.edges.find(
    (e) => edgeTraversable(e) && (e.dest?.x ?? 0) !== 0 && (e.dest?.y ?? 0) !== 0,
  );
  assert.ok(edge, "no explicit-destination edge found");
  const arrival = resolveArrival(graph, edge);
  assert.equal(arrival.x, edge.dest.x);
  assert.equal(arrival.y, edge.dest.y + 1);
});

test("every traversable edge resolves to a standable arrival tile", () => {
  const failures = [];
  for (const edge of graph.edges) {
    if (!edgeTraversable(edge)) continue;
    const arrival = resolveArrival(graph, edge);
    const dest = graph.models.get(edge.to);
    if (!arrival
      || arrival.x < 0 || arrival.y < 0
      || arrival.x >= dest.cols || arrival.y >= dest.rows) {
      failures.push(`${edge.from}->${edge.to}: out of bounds ${JSON.stringify(arrival)}`);
      continue;
    }
    const blocked = blockedTiles(dest, {
      plateDown: () => false,
      pushableTiles: new Set(dest.pushables.map((p) => tileKey(p.start.x, p.start.y))),
    });
    // The teleporter-tile fallback of stepOutOf is legitimate (the player
    // materializes on the door and walks off), so only flag arrivals that
    // are blocked AND not on a teleporter of the destination zone.
    const k = tileKey(arrival.x, arrival.y);
    const onTeleporter = dest.teleporters.some((t) =>
      t.tiles.some((p) => p.x === arrival.x && p.y === arrival.y));
    if (blocked.has(k) && !onTeleporter) {
      failures.push(`${edge.from}->${edge.to}: arrival ${k} blocked`);
    }
  }
  assert.deepEqual(failures, []);
});
