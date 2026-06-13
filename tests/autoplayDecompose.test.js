// Sub-goal decomposition: the multi-box Sokoban dungeons whose keys gate the
// finale (1013 = 4 boxes, 1021 = 5 boxes) must solve under a modest state cap
// and fast. The plain joint search drowned in their free-floor box-shuffle
// space (200k states / 2.5 min and still failing); decomposition solves them
// in well under a second by filling one colored plate at a time. Unlike the
// AUTOPLAY_WIP puzzles suite (full-world sweep, ~25s), this is a tight,
// always-on regression guard run by `npm run test:unit`, using the live bot's
// real solver options (barrelsBlock + avoidTeleporters).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { discoverWorld } from "../js/autoplay/worldIndex.js";
import { buildZoneGraph, edgeTraversable, resolveArrival } from "../js/autoplay/zoneGraph.js";
import { solveToTiles } from "../js/autoplay/puzzleSolver.js";

const world = discoverWorld(loadWorldFromDisk().loadRawZone);
const graph = buildZoneGraph(world);
const KEY_SPECIES = new Set([2000, 2001, 2002, 2003, 2004, 2005]);
// Match the live bot's solver options (botSolver → solverWorker): swordless so
// barrels are walls, never step onto a teleporter mid-puzzle, 12k state cap.
const BOT_OPTS = { maxStates: 12000, barrelsBlock: true, avoidTeleporters: true };
// 1021 (5 boxes, 120×80) solves in ~10s — fine off-thread in the worker, too
// slow for the fast inner loop. Guard it under AUTOPLAY_WIP; 1013 (4 boxes,
// ~0.7s) is the always-on proof that decomposition cracks the multi-box case.
const WIP = process.env.AUTOPLAY_WIP === "1" ? false : "slow (~10s): run with AUTOPLAY_WIP=1";

function inboundArrivals(zoneId) {
  const tiles = [];
  for (const e of graph.edges) {
    if (e.to !== zoneId || !edgeTraversable(e)) continue;
    const a = resolveArrival(graph, e);
    if (a) tiles.push(a);
  }
  return tiles;
}

function keyTiles(model) {
  const p = model.pickups.find((q) => KEY_SPECIES.has(q.speciesId));
  return p ? p.tiles : null;
}

// Solve the key from whichever inbound entrance solves it (the tour may enter
// any of them). Returns the winning result, or the last failure.
function solveKeyFromAnyEntry(zoneId) {
  const model = graph.models.get(zoneId);
  const tiles = keyTiles(model);
  assert.ok(tiles, `zone ${zoneId} has no key pickup`);
  let last = null;
  for (const entry of inboundArrivals(zoneId)) {
    last = solveToTiles(model, entry, tiles, BOT_OPTS);
    if (last.reachable) return last;
  }
  return last;
}

test("zone 1013 (4-box dungeon) solves under cap via decomposition", () => {
  const t0 = Date.now();
  const r = solveKeyFromAnyEntry(1013);
  assert.ok(r?.reachable, `1013 key must be solvable (reason: ${r?.reason})`);
  assert.ok(r.actions.some((a) => a.push != null), "1013 needs box pushes");
  assert.ok(Date.now() - t0 < 5000, "1013 solves in under 5s");
});

test("zone 1021 (5-box dungeon) solves under cap via decomposition", { skip: WIP }, () => {
  const r = solveKeyFromAnyEntry(1021);
  assert.ok(r?.reachable, `1021 key must be solvable (reason: ${r?.reason})`);
  assert.ok(r.actions.some((a) => a.push != null), "1021 needs box pushes");
});

// Guard the already-working 3-box dungeons against a decomposition regression.
for (const zoneId of [1007, 1009]) {
  test(`zone ${zoneId} (3-box dungeon) still solves`, () => {
    const r = solveKeyFromAnyEntry(zoneId);
    assert.ok(r?.reachable, `${zoneId} key must stay solvable (reason: ${r?.reason})`);
  });
}
