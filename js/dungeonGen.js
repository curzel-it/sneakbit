// Procedural dungeon generator.
//
// Emits a raw zone (the shape data/<id>.json holds and buildZone consumes)
// containing a left-to-right chain of rooms, each gated by a pressure-plate
// puzzle. Puzzles use only pushable boxes, gates and inverse gates — no keys,
// matching the hand-authored dungeons (data/1004.json, 1009.json, …).
//
// Every layout is verified with dungeonSolver.isDungeonSolvable before it is
// returned, so a generated dungeon is guaranteed completable: spawn on the
// entrance teleporter, push each box onto its plate to open the colour-matched
// gate, and reach the exit teleporter at the far end.
//
// Why one zone of many rooms (not one zone per room): it mirrors the authored
// convention (a single Dungeon zone split into rooms by gates) and keeps plate
// state — which is global per colour — contained and easy to reason about.
//
// Constraint: plate state is keyed by colour (Yellow/Red/Green/Blue/Silver),
// so a zone has at most five independent locks and never two plates of the
// same colour. Room count is clamped to five for that reason.

import { makeRng } from "./rng.js";
import { isDungeonSolvable } from "./dungeonSolver.js";

// Lock colours, one per room. Order is the species-offset order too.
const COLOURS = ["Yellow", "Red", "Green", "Blue", "Silver"];
export const MAX_ROOMS = COLOURS.length;

// Species ids (see data/species.json). Coloured variants are base + index.
const GATE_BASE = 1040;
const PLATE_BASE = 1050;
const INVERSE_GATE_BASE = 1060;
const BOX_SPECIES_ID = 1030;
const TELEPORTER_SPECIES_ID = 1019;

// Dungeon tile alphabet. Floor is DARK_ROCK ('8'); walls/void are DARK_WATER
// ('J'), which biomeIsObstacle treats as solid. Construction stays empty.
const FLOOR = "8";
const WALL = "J";
const NO_CONSTRUCTION = "0";

const BIOME_SHEET_ID = 1002;
const CONSTRUCTION_SHEET_ID = 1003;
const DUNGEON_SOUNDTRACK = "pol_the_dojo_short.mp3";
const DEFAULT_RETURN_ZONE = 1001; // STARTING_ZONE_ID — where the doors lead.

// Room geometry (interior tiles). Generous enough to walk around a box.
const ROOM_W = 9;
const ROOM_H = 9;
const PAD = 2; // outer wall margin
const PUZZLE_ROW_OFF = 1; // puzzle sits near the top; door row stays clear

function fullEntity(id, speciesId, x, y, lockType, destination) {
  return {
    after_dialogue: "Nothing",
    contents: null,
    demands_attention: false,
    destination: destination ?? null,
    dialogues: [],
    direction: "Down",
    display_conditions: [],
    frame: { x, y, w: 1, h: 1 },
    id,
    is_consumable: false,
    lock_type: lockType ?? "None",
    species_id: speciesId,
  };
}

function teleporter(id, x, y, returnZone) {
  return fullEntity(id, TELEPORTER_SPECIES_ID, x, y, "None", {
    direction: "None",
    world: returnZone,
    x: 0,
    y: 0,
  });
}

// Assemble one candidate dungeon. Templates are fixed-geometry and provably
// solvable; the seed only chooses which template each room uses, so re-rolls
// are about variety, not correcting broken layouts.
function build(id, rooms, returnZone, templates) {
  const roomX0 = (i) => PAD + i * (ROOM_W + 1);
  const y0 = PAD;
  const doorY = y0 + Math.floor(ROOM_H / 2);
  const lastX0 = roomX0(rooms - 1);
  const exitX = lastX0 + ROOM_W + 1; // one tile past the last room's gate
  const cols = exitX + 1 + PAD;
  const rows = y0 + ROOM_H + PAD;

  const biome = Array.from({ length: rows }, () => Array(cols).fill(WALL));
  const construction = Array.from({ length: rows }, () => Array(cols).fill(NO_CONSTRUCTION));
  const carve = (x, y) => { if (y >= 0 && y < rows && x >= 0 && x < cols) biome[y][x] = FLOOR; };

  // Carve each room, the gate doorway to its right, and (for the last room)
  // the exit niche beyond its gate.
  for (let i = 0; i < rooms; i++) {
    const x0 = roomX0(i);
    for (let y = y0; y < y0 + ROOM_H; y++) {
      for (let x = x0; x < x0 + ROOM_W; x++) carve(x, y);
    }
    carve(x0 + ROOM_W, doorY); // doorway tile (holds the gate)
  }
  carve(exitX, doorY); // exit niche floor (holds the exit teleporter)

  const entities = [];
  let nextId = id * 100 + 1; // deterministic, unique within the zone

  // Entrance teleporter FIRST so the engine spawns the player on it
  // (snapToEntry / computeEntryTile pick the first teleporter).
  entities.push(teleporter(nextId++, roomX0(0), doorY, returnZone));

  for (let i = 0; i < rooms; i++) {
    const x0 = roomX0(i);
    const ci = i; // colour / species index
    const colour = COLOURS[ci];
    const py = y0 + PUZZLE_ROW_OFF;

    // Forward gate: opens when this room's plate is pressed.
    entities.push(fullEntity(nextId++, GATE_BASE + ci, x0 + ROOM_W, doorY, colour));

    if (templates[i] === "B") {
      // Box pushed RIGHT through an open inverse gate onto the plate. The
      // inverse gate is open while the plate is up (the whole approach), so
      // the box passes; once the box lands the forward gate opens and the
      // inverse gate closes behind it (harmless — the box is already past).
      entities.push(fullEntity(nextId++, BOX_SPECIES_ID, x0 + 5, py, "None"));
      entities.push(fullEntity(nextId++, INVERSE_GATE_BASE + ci, x0 + 6, py, colour));
      entities.push(fullEntity(nextId++, PLATE_BASE + ci, x0 + 7, py, colour));
    } else {
      // Box pushed RIGHT one tile onto the plate; box (not the player) holds
      // the gate open, so the player is free to walk on through.
      entities.push(fullEntity(nextId++, BOX_SPECIES_ID, x0 + 6, py, "None"));
      entities.push(fullEntity(nextId++, PLATE_BASE + ci, x0 + 7, py, colour));
    }
  }

  // Exit teleporter LAST so it is never mistaken for the spawn door.
  entities.push(teleporter(nextId++, exitX, doorY, returnZone));

  return {
    id,
    world_type: "Dungeon",
    biome_tiles: { sheet_id: BIOME_SHEET_ID, tiles: biome.map((r) => r.join("")) },
    construction_tiles: {
      sheet_id: CONSTRUCTION_SHEET_ID,
      tiles: construction.map((r) => r.join("")),
    },
    entities,
    cutscenes: [],
    light_conditions: "Day",
    soundtrack: DUNGEON_SOUNDTRACK,
    ephemeral_state: true,
    revision: 0,
  };
}

// Decide each room's template from the seed, guaranteeing at least one
// inverse-gate room (template B) so every dungeon shows both gate types.
function pickTemplates(rng, rooms) {
  const templates = [];
  for (let i = 0; i < rooms; i++) templates.push(rng() < 0.5 ? "A" : "B");
  if (!templates.includes("B")) templates[0] = "B";
  return templates;
}

export function generateDungeon({
  seed = 0,
  id,
  rooms = 4,
  returnZone = DEFAULT_RETURN_ZONE,
} = {}) {
  if (!Number.isFinite(id)) throw new Error("generateDungeon: numeric id required");
  const roomCount = Math.max(1, Math.min(MAX_ROOMS, rooms | 0));
  const rng = makeRng(seed >>> 0);

  // Generate-and-verify: templates are solvable by construction, but the
  // solver is the source of truth. Re-roll the template mix a few times
  // before giving up (guards future edits, not today's known-good layouts).
  for (let attempt = 0; attempt < 16; attempt++) {
    const templates = pickTemplates(rng, roomCount);
    const zone = build(id, roomCount, returnZone, templates);
    if (isDungeonSolvable(zone)) return zone;
  }
  throw new Error("generateDungeon: failed to produce a solvable dungeon");
}
