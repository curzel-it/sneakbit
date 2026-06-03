// Tower Defense build shop: the build-phase interaction that turns gold into
// placed obstacles. The player picks a barrel from the HUD palette, then clicks
// a tile to buy and place it; right-click removes a placed barrel and reclaims
// its cost. Placement is gated to the build phase and to legal tiles, and —
// the crux of corridor-building — rejected if it would seal the goal off from
// any spawn (the anti-wall-off rule the flow field answers directly).
//
// Every shop item is an "entity": a barrel prop pushed into raw.entities. It's
// rigid, so it blocks the horde via tdObstacleAt, and it's flagged invulnerable
// so stray fire can't break the maze the player built — it stands for the whole
// run. (Trees and the map shell are authored construction tiles; the shop never
// touches the construction grid.)
//
// Reuses the same primitives the map editor uses to mutate a zone: edit the
// raw entity list, rebuild the zone so collision + entities refresh, then
// recompute the flow field.

import { TILE_SIZE } from "./constants.js";
import { buildZone } from "./zone.js";
import { getSpecies } from "./species.js";
import { recomputeField, spawnsReachGoal, getGoal, getSpawns } from "./tdBoard.js";
import { tdObstacleAt, isBuildObstacleSpecies, obstacleFeetTile, BARREL_SPECIES } from "./tdObstacles.js";
import { getGold, spendGold, addGold, canAfford } from "./arcadeCurrency.js";
import { showToast } from "./toast.js";

// The build palette. Order is the HUD button order; the first entry is the
// default selection. Extend this list to stock more props. For now: the four
// barrel colours (the "variety" the run ships with), all permanent obstacles.
export const BUILD_ITEMS = Object.freeze([
  { id: "barrel_wood", label: "Wood barrel", kind: "entity", species: BARREL_SPECIES.wood, cost: 10 },
  { id: "barrel_brown", label: "Brown barrel", kind: "entity", species: BARREL_SPECIES.brown, cost: 10 },
  { id: "barrel_green", label: "Green barrel", kind: "entity", species: BARREL_SPECIES.green, cost: 10 },
  { id: "barrel_purple", label: "Purple barrel", kind: "entity", species: BARREL_SPECIES.purple, cost: 10 },
]);

const DEFAULT_ITEM = BUILD_ITEMS[0];
const DEFAULT_ITEM_ID = DEFAULT_ITEM.id;

// Cost lookup for refunds (a placed barrel only carries its species id).
const COST_FOR_SPECIES = new Map(
  BUILD_ITEMS.map((i) => [i.species, i.cost]),
);

// Negative-id pool for build-placed entities — clear of the editor pool (-1…)
// and the enemy pool (-2_000_000…) so ids never collide.
let nextBuildEntityId = -3_000_000;
// Ids of the barrels this run has placed, so we can refund the ones the player
// removes and report the count to the HUD.
const placedBarrelIds = new Set();

let selectedId = DEFAULT_ITEM_ID;

let getState = () => null;
let isBuildPhase = () => false;
let onChange = () => {};
let installed = false;

// Build placement is driven by the active hero (towerDefense.onKey calls
// placeSelected/eraseAt with the tile in front of the hero) — there's no
// mouse path. installBuild just wires the state/phase getters the placement
// helpers read.
export function installBuild(stateGetter, opts = {}) {
  getState = stateGetter || (() => null);
  if (typeof opts.isBuildPhase === "function") isBuildPhase = opts.isBuildPhase;
  if (typeof opts.onChange === "function") onChange = opts.onChange;
  if (installed) return;
  installed = true;
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

// The selected catalog item ({ id, label, cost }) — for the placing-bar label.
export function getSelectedBuildItem() {
  const def = selectedDef();
  return { id: def.id, label: def.label, cost: def.cost };
}

// Move the selection to the next/previous catalog item (wraps). Drives the
// shop dialog's arrow/d-pad selection for keyboard + gamepad players.
export function cycleSelectedItem(delta) {
  const i = BUILD_ITEMS.findIndex((it) => it.id === selectedId);
  const n = BUILD_ITEMS.length;
  const next = ((i + (delta | 0)) % n + n) % n;
  selectedId = BUILD_ITEMS[next].id;
  return selectedId;
}

export function setSelectedItem(id) {
  if (BUILD_ITEMS.some((i) => i.id === id)) selectedId = id;
}

function selectedDef() {
  return BUILD_ITEMS.find((i) => i.id === selectedId) || DEFAULT_ITEM;
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
// Every build item is a barrel entity, read from its species sprite frame.
function iconFor(item) {
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

// Source rect + footprint of the currently-selected build item, for the
// in-world placement ghost (tdPlacementPreview). Mirrors iconFor but also
// reports the tile footprint and cost the preview needs.
export function getSelectedBuildSprite() {
  const def = selectedDef();
  const sp = getSpecies(def.species);
  return {
    ...iconFor(def),
    w: Math.max(1, sp?.width || 1),
    h: Math.max(1, sp?.height || 1),
    cost: def.cost,
  };
}

export function placeSelected(x, y) {
  return placeItem(selectedDef(), x, y);
}

// Back-compat for the debug hook (window.td.place) and the e2e suite: place the
// default barrel regardless of the current palette selection.
export function placeDefaultItem(x, y) {
  return placeItem(DEFAULT_ITEM, x, y);
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

  const placed = placeEntity(state, def, x, y);
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
    // Player-placed props are permanent: stray fire can't destroy them, so the
    // maze the player builds stands for the whole run (combat skips _invulnerable
    // targets; the flag survives buildZone's shallow entity clone).
    _invulnerable: true,
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

  // Remove the barrel whose feet sit on this tile, if any.
  const barrel = barrelAtTile(state.rawZone, x, y);
  if (barrel) {
    state.rawZone.entities = state.rawZone.entities.filter((e) => e !== barrel);
    placedBarrelIds.delete(barrel.id);
    rebuild(state);
    addGold(COST_FOR_SPECIES.get(barrel.species_id) || 0);
    onChange();
    return true;
  }
  return false;
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
