// Where a boot lands the player when the save names a zone but no tile.
//
// Rust saves only ever stored `latest_world`, so every save migrated from the
// Steam/iOS/Android builds boots this way. It used to place the player *on*
// the zone's first teleporter — in 1002 that's the door back to 1001, so the
// first step in the wrong direction warped the player straight back out of
// the city they'd just loaded into. main.js::computeEntryTile now steps one
// tile out of the door, the same rule travelTo already used for arrivals.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildZone, isWalkable, isEntityBlocked } from "../js/zone.js";
import { tileInFrontOf } from "../js/transitions.js";

const DATA = new URL("../data/", import.meta.url);
const TELEPORTER_SPECIES_ID = 1019;

function zone(id) {
  return buildZone(JSON.parse(readFileSync(new URL(`${id}.json`, DATA), "utf8")));
}

function firstTeleporter(z) {
  return (z.entities || []).find((e) => e.species_id === TELEPORTER_SPECIES_ID && e.frame);
}

test("1002 boots beside the door back to 1001, not on it", () => {
  const z = zone(1002);
  const door = firstTeleporter(z);
  assert.deepEqual({ x: door.frame.x, y: door.frame.y }, { x: 82, y: 45 },
    "the first teleporter in 1002 is the one back to 1001");
  assert.equal(door.destination.world ?? door.destination.zone, 1001);

  const [x, y] = tileInFrontOf(z, door.frame);
  assert.deepEqual([x, y], [81, 45],
    "one tile west of the door — walking east is what returns you to 1001");
});

test("every shipped zone's entry tile is walkable and off the door", () => {
  const ids = readdirSync(DATA).filter((f) => /^\d+\.json$/.test(f));
  assert.ok(ids.length > 100, "found the zone files");
  for (const file of ids) {
    const z = buildZone(JSON.parse(readFileSync(new URL(file, DATA), "utf8")));
    const door = firstTeleporter(z);
    if (!door) continue;
    const [x, y] = tileInFrontOf(z, door.frame);
    assert.ok(x !== door.frame.x || y !== door.frame.y,
      `${file}: entry tile is still the teleporter tile (${x},${y})`);
    assert.ok(isWalkable(z, x, y) && !isEntityBlocked(z, x, y),
      `${file}: entry tile (${x},${y}) is not standable`);
  }
});
