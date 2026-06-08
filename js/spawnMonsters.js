// Procedural monster placement. A zone opts in via a `monster_spawn` field in
// its JSON; this scatters base-tier berries across walkable tiles and the
// existing fusion mechanic (js/monsters.js) manufactures everything above
// tier 1 on its own. See docs/procedural-monster-spawning.md.
//
// Placement is fully deterministic — seeded off the zone id (js/rng.js) — so
// every co-op peer generates the identical layout with zero bytes on the wire.
// Generated monsters are ephemeral: never persisted, regenerated on each visit.

import { getSpecies } from "./species.js";
import { makeRng, zoneSeed } from "./rng.js";

const SPECIES_BLACKBERRY = 4004; // staple base tier
const SPECIES_CHOKEBERRY = 4003; // occasional low-end flavour
const TELEPORTER_SPECIES_ID = 1019;

// Keep generated spawns this many tiles from a door/teleporter so the player
// never materialises inside a fresh mob on zone entry (every entry point is a
// teleporter), and apart from each other so fusion has room to develop rather
// than collapsing the whole scatter into one strawberry on frame one.
const TELEPORTER_CLEAR_RADIUS = 4;
const MIN_MONSTER_SPACING = 4;

// Generated ids live in their own far negative band, clear of authored ids,
// of runtime coins (-2,000,000-ish, js/coinDrops.js), and of spawned bullets.
// Derived from a per-zone base + index so both peers agree and ids never
// depend on zone-load order.
const GENERATED_ID_BASE = -9_000_000;

// Append procedurally-generated monsters to a freshly-built zone. Reads the
// raw JSON for the opt-in config and authored-entity footprints. Returns the
// generated entities (also pushed onto zone.entities) so callers/tests can
// inspect them. No-op (returns []) for zones without a `monster_spawn` field.
export function populateMonsters(zone, raw) {
  const generated = generateMonsters(zone, raw);
  if (generated.length) zone.entities.push(...generated);
  return generated;
}

// Pure generator: (zone, raw) -> monster entity[]. Side-effect-free so it's
// directly unit-testable.
export function generateMonsters(zone, raw) {
  const cfg = raw?.monster_spawn;
  if (!cfg || !(cfg.density > 0)) return [];

  const rand = makeRng(zoneSeed(zone.id));
  const excluded = buildExclusionMask(zone, raw);

  const eligible = [];
  for (let y = 0; y < zone.rows; y++) {
    for (let x = 0; x < zone.cols; x++) {
      if (excluded[y][x]) continue;
      if (!walkable(zone, x, y)) continue;
      eligible.push([x, y]);
    }
  }
  if (eligible.length === 0) return [];

  const target = Math.round(cfg.density * eligible.length);
  if (target <= 0) return [];

  shuffle(eligible, rand);

  // Greedy Poisson-disk-ish accept: take shuffled tiles that clear the spacing
  // radius from every already-accepted one, until we hit the target or run dry.
  const spacingSq = MIN_MONSTER_SPACING * MIN_MONSTER_SPACING;
  const accepted = [];
  for (const t of eligible) {
    if (accepted.length >= target) break;
    let ok = true;
    for (const a of accepted) {
      const dx = a[0] - t[0];
      const dy = a[1] - t[1];
      if (dx * dx + dy * dy < spacingSq) { ok = false; break; }
    }
    if (ok) accepted.push(t);
  }

  const chokeChance = cfg.chokeberry_chance || 0;
  const out = [];
  for (let i = 0; i < accepted.length; i++) {
    const [x, y] = accepted[i];
    const speciesId = rand() < chokeChance ? SPECIES_CHOKEBERRY : SPECIES_BLACKBERRY;
    out.push(makeMonster(GENERATED_ID_BASE - i, speciesId, x, y));
  }
  return out;
}

function makeMonster(id, speciesId, tileX, tileY) {
  const sp = getSpecies(speciesId);
  const w = sp?.width || 1;
  const h = sp?.height || 2;
  return {
    id,
    species_id: speciesId,
    frame: { x: tileX, y: tileY, w, h },
    direction: "Down",
    _generated: true, // ephemeral marker: never persisted
  };
}

// Tiles a generated monster may not occupy: authored-entity footprints (so we
// don't stack a berry on an NPC, building, or set-piece monster) plus a clear
// radius around every teleporter/door.
function buildExclusionMask(zone, raw) {
  const mask = new Array(zone.rows);
  for (let y = 0; y < zone.rows; y++) mask[y] = new Array(zone.cols).fill(false);

  for (const e of raw?.entities ?? []) {
    const f = e.frame;
    if (!f) continue;
    const pad = e.species_id === TELEPORTER_SPECIES_ID ? TELEPORTER_CLEAR_RADIUS : 0;
    markRect(mask, zone, f.x - pad, f.y - pad, f.w + 2 * pad, f.h + 2 * pad);
  }
  return mask;
}

// Entity frames can sit at sub-tile positions (decorations are placed with
// fractional x/y), so floor the origin and ceil the extent to mark every
// integer tile the footprint touches — indexing the mask with a fractional
// row would otherwise throw.
function markRect(mask, zone, x, y, w, h) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(zone.cols, Math.ceil(x + w));
  const y1 = Math.min(zone.rows, Math.ceil(y + h));
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      mask[ty][tx] = true;
    }
  }
}

function walkable(zone, x, y) {
  if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return false;
  return !zone.collision[y][x];
}

// Seeded Fisher-Yates, in place.
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
