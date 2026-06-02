// Tower Defense barricades: the build-phase interaction that turns gold into
// walls. Click a tile to buy a barricade (a solid obstacle construction);
// right-click to remove one and reclaim its cost. Placement is gated to the
// build phase and to legal tiles, and — the crux of variant-B mazing — rejected
// if it would seal the goal off from any spawn (the anti-wall-off rule, which
// tdBoard's flow field answers directly).
//
// Reuses the same primitives the map editor uses to mutate a zone: edit the
// raw construction grid, rebuild the zone so collision updates, then recompute
// the flow field. Because barricades are only ever placed between waves (no
// live enemies on the board), rebuilding the zone from raw is safe — there's
// no runtime entity state to lose.

import { TILE_SIZE } from "./constants.js";
import { buildZone } from "./zone.js";
import { CONSTRUCTION, constructionToChar } from "./constructions.js";
import { recomputeField, spawnsReachGoal, getGoal, getSpawns } from "./tdBoard.js";
import { getGold, spendGold, addGold } from "./arcadeCurrency.js";
import { showToast } from "./toast.js";

export const BARRICADE_COST = 20;
// Stone wall blocks both movement and bullets, so a maze wall also gives the
// squad a hard kill-corridor edge. Char 'C' in the construction grid.
const BARRICADE_CONSTRUCTION = CONSTRUCTION.STONE_WALL;
const BARRICADE_CHAR = constructionToChar(BARRICADE_CONSTRUCTION);
const EMPTY_CHAR = "0";

let getState = () => null;
let isBuildPhase = () => false;
let onChange = () => {};
let canvasEl = null;
let installed = false;

export function installBarricades(stateGetter, opts = {}) {
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

function onMouseDown(e) {
  if (!isBuildPhase()) return;
  if (e.button === 2) return; // right-click handled by contextmenu
  const t = eventToTile(e);
  if (!t) return;
  e.preventDefault();
  placeBarricade(t.x, t.y);
}

function onContextMenu(e) {
  if (!isBuildPhase()) return;
  const t = eventToTile(e);
  if (!t) return;
  e.preventDefault();
  eraseBarricade(t.x, t.y);
}

// Place a barricade at (x, y) if it's the build phase, the tile is legal, the
// player can afford it, and it doesn't wall the goal off. Returns true on
// success. Exposed for the debug hook / tests.
export function placeBarricade(x, y) {
  const state = getState();
  if (!state?.rawZone || !state.zone) return false;
  if (!isBuildPhase()) return false;
  if (!isLegalBuildTile(state, x, y)) return false;
  if (getGold() < BARRICADE_COST) { showToast("Not enough gold", "hint"); return false; }

  const prev = getConstructionChar(state.rawZone, x, y);
  setConstructionChar(state.rawZone, x, y, BARRICADE_CHAR);
  rebuild(state);
  if (!spawnsReachGoal()) {
    // Illegal: would seal a spawn off. Revert.
    setConstructionChar(state.rawZone, x, y, prev);
    rebuild(state);
    showToast("Can't wall off the path", "hint");
    return false;
  }
  spendGold(BARRICADE_COST);
  onChange();
  return true;
}

// Remove a TD barricade at (x, y) and refund its cost (build phase only — you
// can't sell walls for profit mid-wave; there's no income from removal).
export function eraseBarricade(x, y) {
  const state = getState();
  if (!state?.rawZone || !state.zone) return false;
  if (!isBuildPhase()) return false;
  if (getConstructionChar(state.rawZone, x, y) !== BARRICADE_CHAR) return false;
  setConstructionChar(state.rawZone, x, y, EMPTY_CHAR);
  rebuild(state);
  addGold(BARRICADE_COST);
  onChange();
  return true;
}

// A tile is legal to build on if it's in bounds, currently walkable (no wall
// or void already there), and not the goal or a spawn tile.
export function isLegalBuildTile(state, x, y) {
  const zone = state.zone;
  if (!zone) return false;
  if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return false;
  if (zone.collision[y][x]) return false; // already blocked
  const goal = getGoal();
  if (goal && goal.x === x && goal.y === y) return false;
  for (const s of getSpawns()) {
    if (s.x === x && s.y === y) return false;
  }
  return true;
}

function rebuild(state) {
  // Rebuild collision/textures from the edited raw grid, preserving the
  // current entity list (just markers in the build phase). buildZone clones
  // raw.entities afresh, so re-point state.zone and recompute the field.
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
