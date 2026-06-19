// PvP arena generator — writes fully x/y-symmetric deathmatch arenas to
// data/<id>.json. Every arena is built from a single top-left quadrant
// (45×45 of a 90×90 map) which is then mirrored across both axes, so all
// four corner spawns face identical cover, weapons and hazards. That four-
// fold symmetry is the whole point: PvP fairness (see js/pvpArenaPool.js).
//
//   node tools/genPvpArena.mjs            # regenerate every arena
//   node tools/genPvpArena.mjs --id 1302  # just one
//
// The arenas are static data shipped under data/ (like the dungeon files):
// the running game never generates them, it just travels to a random one,
// so host and guest stay in sync through the normal zoneChange/snapshot
// path. Re-run this whenever you tweak a layout below.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

const SIZE = 90;             // arena is 90×90, matching the original (1301)
const HALF = SIZE / 2;       // 45 — the quadrant edge / mirror seam
const BIOME_SHEET = 1002;
const CONSTRUCTION_SHEET = 1003;

// Construction palette (chars → data/constructions.js). Walls are FOREST: a
// solid obstacle that also stops bullets and autotiles from its neighbours,
// so we never have to author corner sprites — and '0'/'8'/'9' are all mirror-
// invariant, which keeps symmetry trivially correct.
const FLOOR = "0";   // NOTHING — walkable
const WALL = "8";    // FOREST — blocks movement + bullets (hard cover)
const SOFT = "9";    // BAMBOO — blocks movement, bullets pass (soft cover)

// Biome palette (chars → js/biomes.js). All walkable; per-arena for variety.
const BIOME = { grass: "1", rock: "3", desert: "4" };

// Species frame footprints (w,h) as the original arena ships them. The mirror
// needs the width/height to keep multi-tile pickups on-grid when flipped.
const SPECIES = {
  ar15:        { id: 1162, w: 1, h: 2 },
  cannon:      { id: 1168, w: 2, h: 2 },
  cannonAmmo:  { id: 1170, w: 1, h: 1 },
  ar15Ammo:    { id: 1173, w: 1, h: 1 },
  kunai:       { id: 7001, w: 1, h: 1 },
  barrelBrown: { id: 1073, w: 1, h: 2 },
  barrelPurple:{ id: 1038, w: 1, h: 2 },
  monsterA:    { id: 4004, w: 1, h: 2 },
  monsterB:    { id: 4005, w: 1, h: 2 },
};

function makeGrid(fill) {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => fill));
}

// Paint helpers operate on the TL quadrant only (callers stay within
// 0..44); mirrorGrid() then fills the other three quadrants.
function rect(g, x0, y0, w, h, ch) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) g[y][x] = ch;
    }
  }
}

// Mirror the top-left quadrant into the other three. Char tiles are mirror-
// invariant (no orientation), so this is a plain copy across both axes.
function mirrorGrid(g) {
  for (let y = 0; y < HALF; y++) {
    for (let x = 0; x < HALF; x++) {
      const ch = g[y][x];
      g[y][SIZE - 1 - x] = ch;          // TR
      g[SIZE - 1 - y][x] = ch;          // BL
      g[SIZE - 1 - y][SIZE - 1 - x] = ch; // BR
    }
  }
}

// A forest ring of thickness `t` around the whole arena (symmetric, so it can
// be stamped after mirroring). Keeps players inside and gives corner pockets
// a back wall.
function border(g, t) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < t || y < t || x >= SIZE - t || y >= SIZE - t) g[y][x] = WALL;
    }
  }
}

// Flood fill from the four corner pockets; returns the count of unreachable
// floor tiles so the generator can refuse to ship a sealed-off arena.
function unreachableFloor(g) {
  const seen = makeGrid(false);
  const starts = [[6, 6], [SIZE - 7, 6], [6, SIZE - 7], [SIZE - 7, SIZE - 7]];
  const stack = [];
  for (const [sx, sy] of starts) {
    if (g[sy][sx] === FLOOR && !seen[sy][sx]) { seen[sy][sx] = true; stack.push([sx, sy]); }
  }
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      if (seen[ny][nx] || g[ny][nx] !== FLOOR) continue;
      seen[ny][nx] = true; stack.push([nx, ny]);
    }
  }
  let missed = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      if (g[y][x] === FLOOR && !seen[y][x]) missed++;
  return missed;
}

function entity(speciesId, x, y) {
  return {
    after_dialogue: "Nothing",
    demands_attention: false,
    destination: null,
    dialogues: [],
    direction: "Down",
    display_conditions: [],
    frame: { h: 0, w: 0, x, y }, // h/w filled by caller via species
    id: 0,                       // assigned at emit time
    is_consumable: false,
    lock_type: "None",
    species_id: speciesId,
  };
}

// Expand a TL-quadrant spawn into its four mirrored copies. The flip keeps a
// multi-tile footprint on-grid: a w-wide pickup at x mirrors to 90-x-w.
function mirrorEntities(quadrantSpawns) {
  const out = [];
  for (const { kind, x, y } of quadrantSpawns) {
    const sp = SPECIES[kind];
    if (!sp) throw new Error(`unknown species kind: ${kind}`);
    const xs = [x, SIZE - x - sp.w];
    const ys = [y, SIZE - y - sp.h];
    const placed = new Set();
    for (const px of xs) {
      for (const py of ys) {
        const key = `${px},${py}`;
        if (placed.has(key)) continue; // on-axis spawns would double up
        placed.add(key);
        const e = entity(sp.id, px, py);
        e.frame.w = sp.w; e.frame.h = sp.h;
        out.push(e);
      }
    }
  }
  return out;
}

// ── Arena layouts ─────────────────────────────────────────────────────────
// Each returns { name, biome, build(con) , spawns } where build() paints only
// the TL quadrant of the construction grid and spawns lists TL-quadrant
// pickups. Symmetry is guaranteed by mirrorGrid()/mirrorEntities().

const ARENAS = {
  // 1302 — "Pillars": wide-open desert with a regular lattice of hard-cover
  // forest pillars and soft bamboo nests. Lots of sightlines, easy flanking.
  1302: {
    name: "Pillars",
    biome: BIOME.desert,
    build(con) {
      // 3×3 forest pillars on a 12-tile lattice across the quadrant.
      for (let gy = 14; gy < HALF; gy += 12) {
        for (let gx = 14; gx < HALF; gx += 12) {
          rect(con, gx, gy, 3, 3, WALL);
        }
      }
      // Bamboo nests offset between the pillars for soft cover.
      for (let gy = 20; gy < HALF; gy += 12) {
        for (let gx = 20; gx < HALF; gx += 12) {
          rect(con, gx, gy, 2, 2, SOFT);
        }
      }
    },
    spawns: [
      { kind: "ar15", x: 20, y: 20 },
      { kind: "ar15Ammo", x: 21, y: 18 },
      { kind: "ar15Ammo", x: 19, y: 18 },
      { kind: "kunai", x: 9, y: 9 },
      { kind: "barrelBrown", x: 32, y: 32 },
      { kind: "cannonAmmo", x: 33, y: 30 },
      { kind: "monsterA", x: 26, y: 13 },
    ],
  },

  // 1303 — "Crossfire": grass map split by a thick forest cross with gated
  // gaps, four corner rooms, and a bamboo-screened centre. Tighter, lane-based.
  1303: {
    name: "Crossfire",
    biome: BIOME.grass,
    build(con) {
      // Vertical + horizontal arm of the central cross (TL half of each),
      // leaving a doorway gap near the arm's inner end.
      rect(con, HALF - 3, 8, 3, 24, WALL);   // vertical arm (x≈42..44)
      rect(con, 8, HALF - 3, 24, 3, WALL);   // horizontal arm (y≈42..44)
      rect(con, HALF - 3, 18, 3, 4, FLOOR);  // gap in the vertical arm
      rect(con, 18, HALF - 3, 4, 3, FLOOR);  // gap in the horizontal arm
      // Corner room: an L of wall with an opening toward the centre.
      rect(con, 14, 14, 12, 2, WALL);
      rect(con, 14, 14, 2, 12, WALL);
      rect(con, 19, 14, 3, 2, FLOOR);        // doorway in the top edge
      // Bamboo screen guarding the centre approach.
      rect(con, 34, 34, 4, 4, SOFT);
    },
    spawns: [
      { kind: "cannon", x: 39, y: 39 },      // power weapon near the centre
      { kind: "cannonAmmo", x: 38, y: 37 },
      { kind: "ar15", x: 18, y: 18 },        // inside each corner room
      { kind: "ar15Ammo", x: 17, y: 20 },
      { kind: "kunai", x: 10, y: 24 },
      { kind: "barrelPurple", x: 30, y: 12 },
      { kind: "monsterB", x: 25, y: 25 },
    ],
  },

  // 1304 — "Ringside": rock map with a broken square ring of hard cover around
  // the centre plus chunky corner bulwarks. Rotational, arena-like flow.
  1304: {
    name: "Ringside",
    biome: BIOME.rock,
    build(con) {
      // TL corner of a broken square ring (the ring sits at radius ~13 from
      // centre). Gaps at the arm midpoints let players punch through.
      rect(con, 32, 24, 2, 14, WALL);  // left side of the ring (vertical)
      rect(con, 24, 32, 14, 2, WALL);  // top side of the ring (horizontal)
      rect(con, 32, 30, 2, 4, FLOOR);  // gap in the vertical ring side
      rect(con, 30, 32, 4, 2, FLOOR);  // gap in the horizontal ring side
      // Corner bulwark: a short angled wall giving spawn cover.
      rect(con, 10, 16, 8, 2, WALL);
      rect(con, 16, 10, 2, 8, WALL);
      // A lone forest pillar between bulwark and ring.
      rect(con, 22, 22, 3, 3, WALL);
    },
    spawns: [
      { kind: "cannon", x: 28, y: 28 },      // centre power weapon, ring-guarded
      { kind: "cannonAmmo", x: 27, y: 26 },
      { kind: "ar15", x: 13, y: 22 },
      { kind: "ar15Ammo", x: 14, y: 24 },
      { kind: "kunai", x: 8, y: 8 },
      { kind: "barrelBrown", x: 20, y: 20 },
      { kind: "monsterA", x: 30, y: 14 },
      { kind: "monsterB", x: 14, y: 30 },
    ],
  },
};

function buildArena(id, spec) {
  const con = makeGrid(FLOOR);
  spec.build(con);
  mirrorGrid(con);
  border(con, 3);

  const missed = unreachableFloor(con);
  if (missed > 0) {
    throw new Error(`arena ${id} (${spec.name}): ${missed} floor tiles are walled off`);
  }

  const bio = makeGrid(spec.biome);

  const entities = mirrorEntities(spec.spawns);
  entities.forEach((e, i) => { e.id = 90_000_000 + id * 1000 + i; });

  return {
    biome_tiles: { sheet_id: BIOME_SHEET, tiles: bio.map((row) => row.join("")) },
    construction_tiles: { sheet_id: CONSTRUCTION_SHEET, tiles: con.map((row) => row.join("")) },
    cutscenes: [],
    entities,
    ephemeral_state: true,
    id,
    light_conditions: "Day",
    revision: 0,
    soundtrack: null,
    world_type: "Exterior",
  };
}

const args = process.argv.slice(2);
let only = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--id") only = Number(args[i + 1]);
}

for (const [idStr, spec] of Object.entries(ARENAS)) {
  const id = Number(idStr);
  if (only != null && id !== only) continue;
  const zone = buildArena(id, spec);
  const path = join(DATA_DIR, `${id}.json`);
  writeFileSync(path, JSON.stringify(zone) + "\n");
  console.log(`wrote ${path} — "${spec.name}" (${zone.entities.length} entities)`);
}
