// Pure-logic guards for the puzzle execution pieces: the push-origin math,
// live box lookup, and the engine-true walk pathfinder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { buildZoneModel } from "../js/autoplay/worldModel.js";
import { walkPath, reachableTiles } from "../js/autoplay/puzzleSolver.js";
import { pushOrigin, liveBoxTile } from "../js/autoplay/botPush.js";
import { STARTING_SPAWN } from "../js/constants.js";

const { loadRawZone } = loadWorldFromDisk();

test("pushOrigin is the tile behind the box for the push direction", () => {
  assert.deepEqual(pushOrigin({ x: 10, y: 10 }, "right"), { x: 9, y: 10 });
  assert.deepEqual(pushOrigin({ x: 10, y: 10 }, "left"), { x: 11, y: 10 });
  assert.deepEqual(pushOrigin({ x: 10, y: 10 }, "down"), { x: 10, y: 9 });
  assert.deepEqual(pushOrigin({ x: 10, y: 10 }, "up"), { x: 10, y: 11 });
});

test("liveBoxTile reads an entity's frame tile, or null when absent", () => {
  const zone = { entities: [{ id: 7, frame: { x: 4, y: 9, w: 1, h: 1 } }] };
  assert.deepEqual(liveBoxTile(zone, 7), { x: 4, y: 9 });
  assert.equal(liveBoxTile(zone, 99), null);
});

test("walkPath returns an inclusive tile path between two genuinely-connected tiles", () => {
  const model = buildZoneModel(loadRawZone(1001));
  const region = [...reachableTiles(model, STARTING_SPAWN)]
    .map((k) => { const [x, y] = k.split(",").map(Number); return { x, y }; });
  assert.ok(region.length > 5, "spawn reaches a region");
  const a = region[0];
  const b = region[region.length - 1];
  const path = walkPath(model, a, [b]);
  assert.ok(Array.isArray(path), "a path exists within the reachable region");
  assert.deepEqual(path[0], a);
  assert.deepEqual(path[path.length - 1], b);
});

test("walkPath returns null for an off-map goal", () => {
  const model = buildZoneModel(loadRawZone(1001));
  assert.equal(walkPath(model, { x: 5, y: 5 }, [{ x: -3, y: -3 }]), null);
});

test("walkPath start === goal is a single-tile path", () => {
  const model = buildZoneModel(loadRawZone(1001));
  const p = walkPath(model, { x: 5, y: 5 }, [{ x: 5, y: 5 }]);
  assert.deepEqual(p, [{ x: 5, y: 5 }]);
});
