// Procedural dungeon generator CLI — writes a generated Dungeon zone to
// data/<id>.json (or --out). The generation itself lives in js/dungeonGen.js
// so the same code runs in the browser and the tests; this is just the file
// I/O and argument wrapper.
//
//   node tools/genDungeon.mjs --id 9100 --seed 42 --rooms 4
//   node tools/genDungeon.mjs --id 9100 --rooms 5 --return 1001 --out /tmp/d.json
//
// Then serve the repo (node tools/serve.mjs) and open
//   http://127.0.0.1:8000/play/index.html?zone=9100
// to drop straight into the dungeon (the ?zone= boot param spawns you on the
// entrance teleporter). The doors lead back to the return zone (default 1001).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateDungeon, MAX_ROOMS } from "../js/dungeonGen.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val == null || val.startsWith("--")) { opts[key] = true; continue; }
    opts[key] = val;
    i++;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const id = Number(opts.id);
if (!Number.isFinite(id)) {
  console.error("usage: node tools/genDungeon.mjs --id <zoneId> [--seed n] [--rooms 1..5] [--return zoneId] [--out path]");
  process.exit(1);
}

const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 0;
const rooms = Number.isFinite(Number(opts.rooms)) ? Number(opts.rooms) : 4;
const returnZone = Number.isFinite(Number(opts.return)) ? Number(opts.return) : 1001;

if (rooms > MAX_ROOMS) {
  console.warn(`rooms clamped to ${MAX_ROOMS} (one lock colour per room).`);
}

const zone = generateDungeon({ seed, id, rooms, returnZone });
const out = typeof opts.out === "string" ? opts.out : join(DATA_DIR, `${id}.json`);
writeFileSync(out, JSON.stringify(zone, null, 1) + "\n");

const roomCount = zone.entities.filter((e) => e.species_id >= 1050 && e.species_id <= 1055).length;
console.log(`Wrote ${out}`);
console.log(`  dungeon ${id}: ${roomCount} room(s), seed ${seed}, doors -> zone ${returnZone}`);
console.log(`  play: http://127.0.0.1:8000/play/index.html?zone=${id}`);
