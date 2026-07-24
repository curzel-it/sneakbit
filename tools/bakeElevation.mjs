// One-time (re-runnable) bake of an `elevation_tiles` height map into every
// world JSON. The height map is the authoritative terrain elevation for the
// experimental iso renderer (?iso=1); the classic renderer ignores it entirely.
//
// Legend (same string-grid form as biome_tiles / construction_tiles):
//   '0'..'9'  floor elevation level (0 = lowest terrain in the world)
//   'A'       walkable passage (ramp) between adjacent floors — today these are
//             exactly the slope construction tiles, which this makes redundant.
//
// Seeding: we integrate a height field from the existing slope tiles (the only
// signal we have), then GRADE-LIMIT it — cap every 4-neighbour step at one level
// — so false cliffs (a low patch abutting a high one with no ramp) collapse into
// clean one-tier steps instead of the multi-tier towers raw integration produced.
//
//   node tools/bakeElevation.mjs [--check] [file ...]
//     --check : report what would change, write nothing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constructionFromChar } from "../js/constructions.js";
import { elevationFor, isSlope } from "../js/isoElevation.js";

const DATA_DIR = path.resolve(fileURLToPath(new URL("../data", import.meta.url)));
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const MAX_LEVEL = 9; // single-digit encoding

// Lower any tile more than one level above its lowest neighbour until every
// 4-adjacent step is <= 1. Only lowers, so the per-world minimum (0) is kept.
function gradeLimit(elev, rows, cols) {
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (const [dr, dc] of DIRS) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (elev[r][c] > elev[nr][nc] + 1) { elev[r][c] = elev[nr][nc] + 1; changed = true; }
        }
      }
    }
  }
}

function bakeTiles(raw) {
  const cons = raw.construction_tiles.tiles;
  const rows = cons.length;
  const cols = rows > 0 ? cons[0].length : 0;
  const construction = cons.map((line) => [...line].map(constructionFromChar));

  const elev = elevationFor({ rows, cols, construction }); // drifted seed
  gradeLimit(elev, rows, cols);

  let over = 0;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      if (isSlope(construction[r][c])) { line += "A"; continue; }
      let lvl = elev[r][c];
      if (lvl > MAX_LEVEL) { lvl = MAX_LEVEL; over++; }
      line += String(lvl);
    }
    tiles.push(line);
  }
  return { tiles, over };
}

// Build the elevation_tiles member text and splice it in as the first key of the
// top-level object, matching the file's own layout (pretty vs compact). Every
// other byte — key order, indentation, trailing newline — is left untouched, so
// the git diff is exactly the added field.
function insertField(orig, tiles) {
  if (orig.startsWith("{\n")) {
    const body = JSON.stringify({ tiles }, null, 2).split("\n").map((l) => "  " + l).join("\n");
    const field = `  "elevation_tiles": ${body.slice(2)},\n`;
    return "{\n" + field + orig.slice(2);
  }
  // compact
  const field = `"elevation_tiles":${JSON.stringify({ tiles })},`;
  return "{" + field + orig.slice(1);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const files = args.filter((a) => !a.startsWith("--"));
  const targets = files.length
    ? files.map((f) => path.resolve(f))
    : fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(DATA_DIR, f));

  let wrote = 0, warned = 0, skipped = 0;
  for (const file of targets) {
    const orig = fs.readFileSync(file, "utf8");
    const raw = JSON.parse(orig);
    if (!raw.construction_tiles?.tiles) continue; // not a world file
    if (raw.elevation_tiles) { skipped++; continue; } // already baked; revert to re-bake
    const { tiles, over } = bakeTiles(raw);
    if (over) { warned++; console.warn(`  ! ${path.basename(file)}: ${over} tiles exceeded level ${MAX_LEVEL} (clamped)`); }
    const out = insertField(orig, tiles);
    JSON.parse(out); // guard: never write malformed JSON
    if (check) { console.log(`  would update ${path.basename(file)}`); wrote++; continue; }
    fs.writeFileSync(file, out);
    wrote++;
  }
  console.log(`${check ? "would update" : "updated"} ${wrote} file(s)` +
    `${skipped ? `, ${skipped} already baked` : ""}${warned ? `, ${warned} with clamp warnings` : ""}`);
}

main();
