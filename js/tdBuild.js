// Tower Defense build shop: the build-phase interaction that turns gold into
// placed obstacles. The player picks an item from the HUD palette, then clicks
// a tile to buy and place it; right-click removes a placed item and reclaims
// its cost. Placement is gated to the build phase and to legal tiles, and —
// the crux of corridor-building — rejected if it would seal the goal off from
// any spawn (the anti-wall-off rule the flow field answers directly).
//
// Two kinds of item share one placement path:
//   - "construction": a solid wall edited into the raw construction grid
//     (feeds zone.collision). Permanent for the run.
//   - "entity": a barrel prop pushed into raw.entities. Rigid, so it blocks
//     the horde via tdObstacleAt — but destructible: stray fire can break it
//     and reopen the corridor mid-wave (see reapDeadObstacles).
//
// Reuses the same primitives the map editor uses to mutate a zone: edit the
// raw grid / entity list, rebuild the zone so collision + entities refresh,
// then recompute the flow field.

import { TILE_SIZE } from "./constants.js";
import { buildZone } from "./zone.js";
import { CONSTRUCTION, constructionToChar } from "./constructions.js";
import { getSpecies } from "./species.js";
import { recomputeField, spawnsReachGoal, getGoal, getSpawns } from "./tdBoard.js";
import { tdObstacleAt, isBuildObstacleSpecies, obstacleFeetTile, BARREL_SPECIES } from "./tdObstacles.js";
import { getGold, spendGold, addGold, canAfford } from "./arcadeCurrency.js";
import { showToast } from "./toast.js";

const EMPTY_CHAR = "0";

// The build palette. Order is the HUD button order; the first entry is the
// default selection. Extend this list to stock more props — the placement
// path already handles both kinds. For now: the permanent stone wall plus the
// four destructible barrel colours (the "variety" the run ships with).
export const BUILD_ITEMS = Object.freeze([
  { id: "wall", label: "Wall", kind: "construction", construction: CONSTRUCTION.STONE_WALL, cost: 20 },
  { id: "barrel_wood", label: "Wood barrel", kind: "entity", species: BARREL_SPECIES.wood, cost: 10 },
  { id: "barrel_brown", label: "Brown barrel", kind: "entity", species: BARREL_SPECIES.brown, cost: 10 },
  { id: "barrel_green", label: "Green barrel", kind: "entity", species: BARREL_SPECIES.green, cost: 10 },
  { id: "barrel_purple", label: "Purple barrel", kind: "entity", species: BARREL_SPECIES.purple, cost: 10 },
]);

const WALL_ITEM = BUILD_ITEMS[0];
const DEFAULT_ITEM_ID = BUILD_ITEMS[0].id;

// Cost lookup for refunds (a placed barrel only carries its species id).
const COST_FOR_SPECIES = new Map(
  BUILD_ITEMS.filter((i) => i.kind === "entity").map((i) => [i.species, i.cost]),
);

// Negative-id pool for build-placed entities — clear of the editor pool (-1…)
// and the enemy pool (-2_000_000…) so ids never collide.
let nextBuildEntityId = -3_000_000;
// Ids of the barrels this run has placed, so we can reap the ones the squad
// shoots apart (remove their raw entry, so a later rebuild can't resurrect
// them) and refund the ones the player removes.
const placedBarrelIds = new Set();

let selectedId = DEFAULT_ITEM_ID;

let getState = () => null;
let isBuildPhase = () => false;
let onChange = () => {};
let canvasEl = null;
let installed = false;

export function installBuild(stateGetter, opts = {}) {
  getState = stateGetter || (() => null);
  if (typeof opts.isBuildPhase === "function") isBuildPhase = opts.isBuildPhase;
  if (typeof opts.onChange === "function") onChange = opts.onChange;
  if (installed) return;
  installed = true;
  canvasEl = document.getElementById("game");
  if (!canvasEl) return;
  canvasEl.addEventListener("mousedown", onMouseDown);
  canvasEl.addEventListener("contextmenu", onContextMenu);
}

// Reset per-run build state: selection back to default, placement tracking
// cleared. Called when a fresh run boots.
export function resetBuild() {
  selectedId = DEFAULT_ITEM_ID;
  placedBarrelIds.clear();
  nextBuildEntityId = -3_000_000;
}

export function getSelectedItem() { return selectedId; }
export function getPlacedObstacleCount() { return placedBarrelIds.size; }

export function setSelectedItem(id) {
  if (BUILD_ITEMS.some((i) => i.id === id)) selectedId = id;
}

function selectedDef() {
  return BUILD_ITEMS.find((i) => i.id === selectedId) || WALL_ITEM;
}

// Palette model for the HUD: each item plus its shop icon, whether it's
// selected, and whether the player can currently afford it.
export function getPaletteModel() {
  return BUILD_ITEMS.map((i) => ({
    id: i.id,
    label: i.label,
    cost: i.cost,
    icon: iconFor(i),
    selected: i.id === selectedId,
    can: canAfford(i.cost),
  }));
}

// Source rect (in sheet pixels) of an item's sprite, for the HUD shop icons.
// Mirrors mapEditor's placement ghosts: construction tiles read column = id,
// row 1 (the isolated-tile pattern); entities read their species sprite frame.
function iconFor(item) {
  if (item.kind === "construction") {
    return { sheet: "tilesConstructions", sx: item.construction * TILE_SIZE, sy: TILE_SIZE, sw: TILE_SIZE, sh: TILE_SIZE };
  }
  const sp = getSpecies(item.species);
  const w = Math.max(1, sp?.width || 1);
  const h = Math.max(1, sp?.height || 1);
  // Every build entity so far lives on the static_objects sheet (barrels).
  return {
    sheet: "static_objects",
    sx: (sp?.texture_x || 0) * TILE_SIZE,
    sy: (sp?.texture_y || 0) * TILE_SIZE,
    sw: w * TILE_SIZE,
    sh: h * TILE_SIZE,
  };
}

// Short HUD hint naming the active item.
export function buildHintText() {
  const def = selectedDef();
  return `Click a tile to place ${def.label} (${def.cost}g)`;
}

function onMouseDown(e) {
  if (!isBuildPhase()) return;
  if (e.button === 2) return; // right-click handled by contextmenu
  const t = eventToTile(e);
  if (!t) return;
  e.preventDefault();
  placeSelected(t.x, t.y);
}

function onContextMenu(e) {
  if (!isBuildPhase()) return;
  const t = eventToTile(e);
  if (!t) return;
  e.preventDefault();
  eraseAt(t.x, t.y);
}

export function placeSelected(x, y) {
  return placeItem(selectedDef(), x, y);
}

// Back-compat for the debug hook (window.td.place) and the e2e suite: place a
// stone wall regardless of the current palette selection.
export function placeBarricade(x, y) {
  return placeItem(WALL_ITEM, x, y);
}

// Place a build item at (x, y) if it's the build phase, the tile is legal, the
// player can afford it, and it doesn't wall the goal off. Returns true on
// success.
function placeItem(def, x, y) {
  const state = getState();
  if (!def || !state?.rawZone || !state.zone) return false;
  if (!isBuildPhase()) return false;
  if (!isLegalBuildTile(state, x, y)) return false;
  if (getGold() < def.cost) { showToast("Not enough gold", "hint"); return false; }

  const placed = def.kind === "entity"
    ? placeEntity(state, def, x, y)
    : placeConstruction(state, def, x, y);
  if (!placed) return false;

  if (!spawnsReachGoal()) {
    // Illegal: would seal a spawn off. Revert before spending a coin.
    placed.revert();
    rebuild(state);
    showToast("Can't wall off the path", "hint");
    return false;
  }
  spendGold(def.cost);
  placed.commit?.();
  onChange();
  return true;
}

function placeConstruction(state, def, x, y) {
  const ch = constructionToChar(def.construction);
  const prev = getConstructionChar(state.rawZone, x, y);
  setConstructionChar(state.rawZone, x, y, ch);
  rebuild(state);
  return { revert: () => setConstructionChar(state.rawZone, x, y, prev) };
}

function placeEntity(state, def, x, y) {
  const sp = getSpecies(def.species);
  const w = Math.max(1, sp?.width || 1);
  const h = Math.max(1, sp?.height || 1);
  // Anchor the prop's feet on the clicked tile (sprite extends upward, like an
  // NPC), so the tile the player clicked is the tile that blocks.
  const ent = {
    id: nextBuildEntityId--,
    species_id: def.species,
    direction: "Down",
    frame: { x, y: y - (h - 1), w, h },
  };
  state.rawZone.entities = state.rawZone.entities ?? [];
  state.rawZone.entities.push(ent);
  rebuild(state);
  return {
    revert: () => {
      state.rawZone.entities = state.rawZone.entities.filter((e) => e !== ent);
    },
    commit: () => { placedBarrelIds.add(ent.id); },
  };
}

// Remove a player-placed item at (x, y) and refund its cost (build phase only —
// you can't sell mid-wave; there's no income from removal).
export function eraseAt(x, y) {
  const state = getState();
  if (!state?.rawZone || !state.zone) return false;
  if (!isBuildPhase()) return false;

  // Prefer removing a barrel whose feet sit on this tile…
  const barrel = barrelAtTile(state.rawZone, x, y);
  if (barrel) {
    state.rawZone.entities = state.rawZone.entities.filter((e) => e !== barrel);
    placedBarrelIds.delete(barrel.id);
    rebuild(state);
    addGold(COST_FOR_SPECIES.get(barrel.species_id) || 0);
    onChange();
    return true;
  }

  // …otherwise a stone-wall construction tile.
  if (getConstructionChar(state.rawZone, x, y) === constructionToChar(WALL_ITEM.construction)) {
    setConstructionChar(state.rawZone, x, y, EMPTY_CHAR);
    rebuild(state);
    addGold(WALL_ITEM.cost);
    onChange();
    return true;
  }
  return false;
}

// Sweep placed barrels the squad has destroyed during a wave: drop their raw
// entry (so the next rebuild can't bring them back) and forget them. Returns
// true if anything was reaped, so the caller can recompute the field and let
// the horde flow through the new gap.
export function reapDeadObstacles(state) {
  if (!placedBarrelIds.size || !state?.rawZone) return false;
  const zone = state.zone;
  let changed = false;
  for (const id of [...placedBarrelIds]) {
    if (isLiveObstacle(zone, id)) continue;
    state.rawZone.entities = (state.rawZone.entities || []).filter((e) => e.id !== id);
    placedBarrelIds.delete(id);
    changed = true;
  }
  return changed;
}

function isLiveObstacle(zone, id) {
  const e = zone?.entities?.find((x) => x.id === id);
  return !!e && !e._dying && isBuildObstacleSpecies(e.species_id);
}

function barrelAtTile(raw, x, y) {
  for (const e of raw.entities || []) {
    if (!isBuildObstacleSpecies(e.species_id)) continue;
    const f = e.frame;
    if (!f) continue;
    const feet = obstacleFeetTile(f);
    if (feet.x === x && feet.y === y) return e;
  }
  return null;
}

// A tile is legal to build on if it's in bounds, currently walkable (no wall
// or void), not already holding a placed prop, and not the goal or a spawn.
export function isLegalBuildTile(state, x, y) {
  const zone = state.zone;
  if (!zone) return false;
  if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return false;
  if (zone.collision[y][x]) return false;     // already a wall / void
  if (tdObstacleAt(zone, x, y)) return false;  // already a barrel — no stacking
  const goal = getGoal();
  if (goal && goal.x === x && goal.y === y) return false;
  for (const s of getSpawns()) {
    if (s.x === x && s.y === y) return false;
  }
  return true;
}

function rebuild(state) {
  // Rebuild collision/textures/entities from the edited raw grid, then
  // recompute the field. Safe in the build phase: there are no live enemies to
  // lose, and buildZone clones raw.entities afresh (placed barrels persist).
  state.zone = buildZone(state.rawZone);
  recomputeField(state.zone);
}

// Convert a canvas mouse event into a zone tile. Mirrors mapEditor's
// canvasEventToTile inverse of the renderer's camera offset.
function eventToTile(e) {
  const state = getState();
  if (!state?.zone || !canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) return null;
  const bx = (cssX / rect.width) * canvasEl.width;
  const by = (cssY / rect.height) * canvasEl.height;
  const ox = Math.round(-state.camera.x * TILE_SIZE);
  const oy = Math.round(-state.camera.y * TILE_SIZE);
  const x = Math.floor((bx - ox) / TILE_SIZE);
  const y = Math.floor((by - oy) / TILE_SIZE);
  if (x < 0 || y < 0 || x >= state.zone.cols || y >= state.zone.rows) return null;
  return { x, y };
}

function getConstructionChar(raw, x, y) {
  const rows = raw.construction_tiles?.tiles;
  const row = rows?.[y];
  if (typeof row !== "string" || x < 0 || x >= row.length) return EMPTY_CHAR;
  return row[x];
}

function setConstructionChar(raw, x, y, ch) {
  const rows = raw.construction_tiles?.tiles;
  if (!Array.isArray(rows) || y < 0 || y >= rows.length) return;
  const row = rows[y];
  if (typeof row !== "string" || x < 0 || x >= row.length) return;
  rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
}
