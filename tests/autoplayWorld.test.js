// World discovery for the autoplay AI: every zone the player can ever
// reach must be discoverable by walking teleporter destinations from the
// starting zone, and every teleporter must point at a zone file that
// exists. Zones NOT discovered must be on the explicit, reviewed list
// below — anything else appearing there is a regression (a zone got
// orphaned from the world graph).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { discoverWorld, zoneDestinations } from "../js/autoplay/worldIndex.js";
import { buildZoneModel, blockedTiles, tileKey } from "../js/autoplay/worldModel.js";
import { zoneObjectives, liveObjectives } from "../js/autoplay/objectiveCatalog.js";
import { buildZone, isWalkable, isEntityBlocked, hasEnterableTeleporter } from "../js/zone.js";
import { setupPuzzles, tickPuzzles } from "../js/puzzles.js";
import { isPressurePlateDown } from "../js/locks.js";
import { _resetStorageForTesting } from "../js/storage.js";

const { loadRawZone, dataDir } = loadWorldFromDisk();
const world = discoverWorld(loadRawZone);

// Gameplay zones reached only through a menu (no inbound teleporter), so
// teleporter discovery legitimately can't see them.
const MENU_ENTERED_ZONES = new Set([
  1099, // demo arena
  1301, // PvP arena (original)
  1302, // PvP arena (Pillars)
  1303, // PvP arena (Crossfire)
  1304, // PvP arena (Ringside)
  1501, // tutorial arena (if present)
]);

// The data dir ships ~twice as many HouseInterior files as the overworld
// actually wires up — the level editor emits an interior per building
// stamp, and unused ones are left in place. Those orphans are expected
// and irrelevant to the bot. What must NEVER be orphaned is a real
// gameplay zone (Exterior / Dungeon): if one falls out of the teleporter
// graph the world is broken. So we assert on world_type, not on a hand
// list of interior ids.
test("no gameplay zone is orphaned from the teleporter graph", () => {
  const allZoneFiles = readdirSync(dataDir)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => parseInt(f, 10));
  const discovered = new Set(world.order);

  const orphanedGameplay = allZoneFiles.filter((id) => {
    if (discovered.has(id) || MENU_ENTERED_ZONES.has(id)) return false;
    const raw = loadRawZone(id);
    return raw && raw.world_type !== "HouseInterior";
  }).sort((a, b) => a - b);
  assert.deepEqual(orphanedGameplay, [],
    `non-HouseInterior zones unreachable from 1001: ${orphanedGameplay}`);

  // The contiguous authored gameplay range must be fully reachable.
  const missingAuthored = [];
  for (let id = 1001; id <= 1022; id++) {
    if (!discovered.has(id)) missingAuthored.push(id);
  }
  assert.deepEqual(missingAuthored, [], `authored zones not discovered: ${missingAuthored}`);
});

test("no teleporter points at a missing zone file", () => {
  assert.deepEqual(world.missingDestinations, []);
});

test("discovery includes the storyline anchors", () => {
  const discovered = new Set(world.order);
  // Start, the six key dungeons, the maze antechamber and the finale.
  for (const id of [1001, 1005, 1007, 1009, 1013, 1016, 1021, 1010, 1017]) {
    assert.ok(discovered.has(id), `zone ${id} missing`);
  }
});

test("zoneDestinations reads raw `world` destinations", () => {
  const raw = world.zones.get(1010);
  assert.ok(zoneDestinations(raw).includes(1017), "1010 should link to 1017");
});

// --- Zone model invariants ---------------------------------------------

test("every discovered zone builds a model with coherent catalogs", () => {
  _resetStorageForTesting();
  for (const [id, raw] of world.zones) {
    const model = buildZoneModel(raw);
    assert.equal(model.id, id);
    const all = zoneObjectives(model);
    const live = liveObjectives(model);
    // On a virgin save nothing is collected/read yet, so every live
    // objective also appears in the static catalog and live never exceeds
    // the static count for any kind.
    assert.ok(live.length <= all.length, `zone ${id}: live > static`);
    for (const t of model.talkables) {
      assert.ok(t.talkTiles.length > 0,
        `zone ${id}: entity ${t.entityId} has dialogues but no reachable talk tile`);
    }
  }
});

// The model's blocked-set must agree with the engine's ground truth
// (isWalkable + isEntityBlocked) tile for tile. Gate tiles are excluded:
// the engine only opens gates on contact (tryUnlockGate) or plate ticks,
// while the model bakes the contact-open rule in — gate passability gets
// its own assertions in the puzzle solver tests.
test("model blocked-set matches engine walkability on sampled tiles", () => {
  _resetStorageForTesting();
  for (const [id, raw] of world.zones) {
    const model = buildZoneModel(raw);
    const engineZone = buildZone(raw);
    setupPuzzles(engineZone);
    tickPuzzles(engineZone, null);

    const gateTiles = new Set(model.gates.flatMap((g) => g.tiles));
    const pushableTiles = new Set(model.pushables.map((p) => tileKey(p.start.x, p.start.y)));
    const blocked = blockedTiles(model, {
      plateDown: (color) => isPressurePlateDown(color),
      pushableTiles,
    });

    // Deterministic tile sample (LCG seeded by zone id) keeps the sweep
    // fast while still touching every zone.
    let seed = id >>> 0;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    for (let i = 0; i < 250; i++) {
      const x = next() % model.cols;
      const y = next() % model.rows;
      const k = tileKey(x, y);
      if (gateTiles.has(k)) continue;
      // canEnter (player.js): an enterable teleporter overrides terrain
      // AND entity collision, so the engine's true walkability isn't just
      // isWalkable+isEntityBlocked on those tiles.
      const onTeleporter = hasEnterableTeleporter(engineZone, x, y);
      const engineBlocked = onTeleporter
        ? false
        : (!isWalkable(engineZone, x, y) || isEntityBlocked(engineZone, x, y));
      assert.equal(blocked.has(k), engineBlocked,
        `zone ${id} tile ${k}: model=${blocked.has(k)} engine=${engineBlocked}`);
    }
  }
});
