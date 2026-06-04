// Creative-mode map editor. Mirrors the Rust desktop's
// game/src/gameui/map_editor.rs: a stockable picker (biome tiles,
// construction tiles, entity species) plus click-to-place / right-click
// to erase, with drag-paint on tile selections.
//
// Edits mutate state.rawZone directly — the same raw JSON object that
// buildZone() consumed at boot. After each placement we re-run
// buildZone(raw) and swap state.zone; the zone cache (WeakMap keyed
// on the zone object) auto-rebuilds on the next render. This matches
// the spec's "edit-then-rebuild" model: whatever the editor produces in
// memory matches the shape of the shipped JSON, so Export-zone is a
// straight serialize.
//
// Desktop-only: the menu entry that opens this is hidden on coarse
// pointers (see js/menu.js's data-desktop-only attribute). The editor
// itself also short-circuits if matchMedia reports a touch device, so
// stray window.creative.openMapEditor() calls don't pop a picker no one
// can dismiss.

import { isCreativeMode } from "./creativeMode.js";
import { TILE_SIZE } from "./constants.js";
import { allSpecies, getSpecies, getEntitySheet } from "./species.js";
import { BIOME, biomeToChar } from "./biomes.js";
import { CONSTRUCTION, constructionToChar } from "./constructions.js";
import { buildZone } from "./zone.js";
import { setupPuzzles } from "./puzzles.js";
import { setupCutscenes } from "./cutscenes.js";
import { invalidateZoneCache } from "./data.js";
import { saveEditedWorld } from "./editedWorlds.js";
import { getBiomeSheet } from "./biomeSheet.js";
import { getSprite } from "./assets.js";
import { tryBuildingPrefab } from "./prefabs.js";
import {
  entityAtTile, openEntityInspector, closeEntityInspector, isEntityInspectorOpen,
  inspectedEntity,
} from "./entityInspector.js";
import { el } from "./dom.js";

let stateGetter = () => null;
let canvasEl = null;
let pickerEl = null;
let ghostCanvas = null;       // overlay canvas for the ghost-sprite preview
let ghostCtx = null;
let ghostRafId = 0;
let cursorCssX = -1;          // last-known mouse position in CSS pixels
let cursorCssY = -1;
let openState = false;
let selection = null; // { kind: "biome"|"construction"|"species", id, label, char? }
let painting = false; // mouse held during a tile-paint stroke

// Negative-id pool for editor-spawned entities — keeps them visually
// distinct in JSON diffs from the zone's shipped ids (which are large
// positive numbers like 10754362). Decrementing keeps subsequent
// placements unique.
let nextEditorEntityId = -1;

// Set of construction ids the editor stocks (paintbrush set). Mirrors
// the list in creative-mode-requirements.md.
const CONSTRUCTION_STOCK_IDS = [
  CONSTRUCTION.WOODEN_FENCE, CONSTRUCTION.METAL_FENCE, CONSTRUCTION.DARK_ROCK,
  CONSTRUCTION.LIGHT_WALL, CONSTRUCTION.COUNTER, CONSTRUCTION.LIBRARY,
  CONSTRUCTION.TALL_GRASS, CONSTRUCTION.FOREST, CONSTRUCTION.BAMBOO,
  CONSTRUCTION.BOX, CONSTRUCTION.RAIL, CONSTRUCTION.STONE_WALL,
  CONSTRUCTION.INDICATOR_ARROW, CONSTRUCTION.BRIDGE, CONSTRUCTION.BROADLEAF,
  CONSTRUCTION.STONE_BOX, CONSTRUCTION.SPOILED_TREE, CONSTRUCTION.WINE_TREE,
  CONSTRUCTION.SOLAR_PANEL, CONSTRUCTION.PIPE, CONSTRUCTION.BROADLEAF_PURPLE,
  CONSTRUCTION.WOODEN_WALL, CONSTRUCTION.SNOW_PILE, CONSTRUCTION.SNOWY_FOREST,
  CONSTRUCTION.DARKNESS_15, CONSTRUCTION.DARKNESS_30, CONSTRUCTION.DARKNESS_45,
  // Slope variants (32 entries: 4 biomes × 8 orientations).
  CONSTRUCTION.SLOPE_GREEN_TL, CONSTRUCTION.SLOPE_GREEN_TR,
  CONSTRUCTION.SLOPE_GREEN_BR, CONSTRUCTION.SLOPE_GREEN_BL,
  CONSTRUCTION.SLOPE_GREEN_B,  CONSTRUCTION.SLOPE_GREEN_T,
  CONSTRUCTION.SLOPE_GREEN_L,  CONSTRUCTION.SLOPE_GREEN_R,
  CONSTRUCTION.SLOPE_ROCK_TL, CONSTRUCTION.SLOPE_ROCK_TR,
  CONSTRUCTION.SLOPE_ROCK_BR, CONSTRUCTION.SLOPE_ROCK_BL,
  CONSTRUCTION.SLOPE_ROCK_B,  CONSTRUCTION.SLOPE_ROCK_T,
  CONSTRUCTION.SLOPE_ROCK_L,  CONSTRUCTION.SLOPE_ROCK_R,
  CONSTRUCTION.SLOPE_SAND_TL, CONSTRUCTION.SLOPE_SAND_TR,
  CONSTRUCTION.SLOPE_SAND_BR, CONSTRUCTION.SLOPE_SAND_BL,
  CONSTRUCTION.SLOPE_SAND_B,  CONSTRUCTION.SLOPE_SAND_T,
  CONSTRUCTION.SLOPE_SAND_L,  CONSTRUCTION.SLOPE_SAND_R,
  CONSTRUCTION.SLOPE_DARKROCK_TL, CONSTRUCTION.SLOPE_DARKROCK_TR,
  CONSTRUCTION.SLOPE_DARKROCK_BR, CONSTRUCTION.SLOPE_DARKROCK_BL,
  CONSTRUCTION.SLOPE_DARKROCK_B,  CONSTRUCTION.SLOPE_DARKROCK_T,
  CONSTRUCTION.SLOPE_DARKROCK_L,  CONSTRUCTION.SLOPE_DARKROCK_R,
];

// Mirrors map_editor.rs's biome stock order (Nothing omitted — it's the
// erase payload, not a paintable choice). Keys map back to CHAR_TO_BIOME
// in biomes.js, so the round-trip through tile strings is lossless.
const BIOME_STOCK_IDS = [
  BIOME.WATER, BIOME.DESERT, BIOME.GRASS, BIOME.DARK_GRASS,
  BIOME.ROCK, BIOME.DARK_ROCK, BIOME.SNOW, BIOME.LIGHT_WOOD,
  BIOME.DARK_WOOD, BIOME.ROCK_PLATES, BIOME.ICE, BIOME.LAVA,
  BIOME.FARMLAND, BIOME.DARK_WATER, BIOME.DARK_SAND, BIOME.SAND_PLATES,
];

const BIOME_LABEL = {
  [BIOME.WATER]: "Water", [BIOME.DESERT]: "Desert", [BIOME.GRASS]: "Grass",
  [BIOME.DARK_GRASS]: "DkGrass", [BIOME.ROCK]: "Rock",
  [BIOME.DARK_ROCK]: "DkRock", [BIOME.SNOW]: "Snow",
  [BIOME.LIGHT_WOOD]: "LtWood", [BIOME.DARK_WOOD]: "DkWood",
  [BIOME.ROCK_PLATES]: "RockPl", [BIOME.ICE]: "Ice", [BIOME.LAVA]: "Lava",
  [BIOME.FARMLAND]: "Farm", [BIOME.DARK_WATER]: "DkWater",
  [BIOME.DARK_SAND]: "DkSand", [BIOME.SAND_PLATES]: "SandPl",
};

export function installMapEditor(getState) {
  if (typeof getState === "function") stateGetter = getState;
  canvasEl = document.getElementById("game");
  if (canvasEl) {
    canvasEl.addEventListener("contextmenu", onCanvasContextMenu);
    canvasEl.addEventListener("mousedown", onCanvasMouseDown);
    canvasEl.addEventListener("mousemove", onCanvasMouseMove);
    canvasEl.addEventListener("mouseup", onCanvasMouseUp);
    canvasEl.addEventListener("mouseleave", () => { painting = false; });
  }
  window.addEventListener("keydown", onWindowKeyDown);
  // Expose for the menu entry. menu.js calls window.creative.openMapEditor().
  if (typeof window !== "undefined") {
    window.creative = window.creative || {};
    window.creative.openMapEditor = openMapEditor;
  }
}

function isTouchDevice() {
  if (typeof matchMedia === "undefined") return false;
  return matchMedia("(pointer: coarse)").matches;
}

export function openMapEditor() {
  if (!isCreativeMode()) return;
  if (isTouchDevice()) return;
  if (openState) return;
  openState = true;
  if (!pickerEl) buildPicker();
  pickerEl.style.display = "block";
  injectStyles();
  populatePicker();
  ensureGhostCanvas();
  startGhostLoop();
}

export function closeMapEditor() {
  if (!openState) return;
  openState = false;
  selection = null;
  painting = false;
  if (pickerEl) pickerEl.style.display = "none";
  closeEntityInspector();
  stopGhostLoop();
  if (ghostCanvas) ghostCanvas.style.display = "none";
}

export function isMapEditorOpen() {
  return openState;
}

function onWindowKeyDown(e) {
  if (!openState) return;
  if (e.code === "Escape") {
    if (isEntityInspectorOpen()) closeEntityInspector();
    else if (selection) { selection = null; renderSelectionHint(); }
    else closeMapEditor();
    e.preventDefault();
  }
}

// Build the picker DOM. One scrollable column on the right with three
// sections: Biomes, Constructions, Entities. Clicking an entry sets
// `selection` so the next canvas click places it.
function buildPicker() {
  pickerEl = el("div", {
    id: "map-editor",
    html: `
    <div class="me-head">
      <strong>Map editor</strong>
      <span class="me-hint">Click to place · Right-click to erase · Esc to close</span>
      <button id="me-close" class="me-close">×</button>
    </div>
    <div class="me-selection" id="me-selection">No selection</div>
    <div class="me-section">
      <h4>Biomes</h4>
      <div class="me-grid" id="me-grid-biomes"></div>
    </div>
    <div class="me-section">
      <h4>Constructions</h4>
      <div class="me-grid" id="me-grid-constructions"></div>
    </div>
    <div class="me-section">
      <h4>Entities</h4>
      <div class="me-grid" id="me-grid-entities"></div>
    </div>
  `,
  });
  document.body.appendChild(pickerEl);
  pickerEl.querySelector("#me-close").addEventListener("click", closeMapEditor);
}

function renderSelectionHint() {
  if (!pickerEl) return;
  const node = pickerEl.querySelector("#me-selection");
  if (!node) return;
  if (!selection) { node.textContent = "No selection — click an item below, or click a placed entity to edit it."; return; }
  node.textContent = `Placing: ${selection.label}`;
}

function populatePicker() {
  populateBiomes();
  populateConstructions();
  populateEntities();
  renderSelectionHint();
}

function populateBiomes() {
  const grid = pickerEl.querySelector("#me-grid-biomes");
  grid.innerHTML = "";
  for (const id of BIOME_STOCK_IDS) {
    const btn = el("button", {
      class: "me-cell me-cell-biome",
      text: BIOME_LABEL[id] ?? `B${id}`,
      title: BIOME_LABEL[id] ?? `Biome ${id}`,
      on: { click: () => {
        selection = { kind: "biome", id, label: `Biome: ${BIOME_LABEL[id]}`, char: biomeToChar(id) };
        highlightSelected(grid, btn);
        renderSelectionHint();
      } },
    });
    grid.appendChild(btn);
  }
}

function populateConstructions() {
  const grid = pickerEl.querySelector("#me-grid-constructions");
  grid.innerHTML = "";
  for (const id of CONSTRUCTION_STOCK_IDS) {
    const btn = el("button", {
      class: "me-cell me-cell-construction",
      text: constructionLabel(id),
      title: constructionLabel(id),
      on: { click: () => {
        selection = { kind: "construction", id, label: `Construction: ${constructionLabel(id)}`, char: constructionToChar(id) };
        highlightSelected(grid, btn);
        renderSelectionHint();
      } },
    });
    grid.appendChild(btn);
  }
}

// Entity stockables: every species with an inventory_texture_offset that
// isn't a weapon (matches map_editor.rs's stockable_species filter).
// Icons come from inventory.png at the species' offset.
function populateEntities() {
  const grid = pickerEl.querySelector("#me-grid-entities");
  grid.innerHTML = "";
  const stock = allSpecies()
    .filter((sp) => !!sp.inventory_texture_offset)
    .filter((sp) => sp.entity_type !== "WeaponMelee" && sp.entity_type !== "WeaponRanged")
    .filter((sp) => sp.entity_type !== "Hero")
    .sort((a, b) => a.entity_type.localeCompare(b.entity_type) || a.id - b.id);
  for (const sp of stock) {
    const [row, col] = sp.inventory_texture_offset;
    const btn = el("button", {
      class: "me-cell me-cell-entity",
      title: `${sp.entity_type} · ${sp.name ?? sp.id}`,
      on: { click: () => {
        selection = {
          kind: "species",
          id: sp.id,
          label: `${sp.entity_type}: ${sp.name ?? sp.id}`,
        };
        highlightSelected(grid, btn);
        renderSelectionHint();
      } },
    }, el("span", { class: "me-icon-wrap" }, el("span", {
      class: "me-icon",
      style: {
        backgroundImage: "url('./assets/inventory.png')",
        backgroundPosition: `-${col * TILE_SIZE}px -${row * TILE_SIZE}px`,
      },
    })));
    grid.appendChild(btn);
  }
}

function constructionLabel(id) {
  // Reverse-lookup the symbolic name from the CONSTRUCTION enum so we
  // don't have to maintain a parallel label table.
  for (const [key, val] of Object.entries(CONSTRUCTION)) {
    if (val === id) return key.replace(/_/g, " ").toLowerCase();
  }
  return `C${id}`;
}

function highlightSelected(grid, btn) {
  // Picking something to place takes over the cursor, so drop any open
  // inspector — its entity is no longer what the next click targets.
  closeEntityInspector();
  for (const c of grid.querySelectorAll(".me-cell")) c.classList.remove("selected");
  // Also clear highlights in OTHER grids so it's clear only one item is active.
  if (pickerEl) {
    for (const c of pickerEl.querySelectorAll(".me-cell.selected")) {
      if (c !== btn) c.classList.remove("selected");
    }
  }
  btn.classList.add("selected");
}

// Convert a mouse event on the game canvas into a zone (tileX, tileY).
// Returns null if the click landed outside the zone.
function canvasEventToTile(e) {
  const state = stateGetter();
  if (!state?.zone || !canvasEl) return null;
  const rect = canvasEl.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  if (cssX < 0 || cssY < 0 || cssX >= rect.width || cssY >= rect.height) return null;
  const bx = (cssX / rect.width) * canvasEl.width;
  const by = (cssY / rect.height) * canvasEl.height;
  // Renderer applies Math.round(-camera.x * TILE_SIZE) as the zone-origin
  // pixel offset; invert that to recover the zone-tile under the cursor.
  const ox = Math.round(-state.camera.x * TILE_SIZE);
  const oy = Math.round(-state.camera.y * TILE_SIZE);
  const zonePxX = bx - ox;
  const zonePxY = by - oy;
  const tileX = Math.floor(zonePxX / TILE_SIZE);
  const tileY = Math.floor(zonePxY / TILE_SIZE);
  if (tileX < 0 || tileY < 0) return null;
  if (tileX >= state.zone.cols || tileY >= state.zone.rows) return null;
  return { tileX, tileY };
}

function onCanvasMouseDown(e) {
  if (!openState || !isCreativeMode()) return;
  if (e.button === 2) return; // right-click handled by contextmenu listener
  const t = canvasEventToTile(e);
  if (!t) return;
  e.preventDefault();
  // No placement selection → click acts as "inspect": open the entity
  // inspector for whatever entity sits under the cursor so its
  // after-dialogue behavior can be retagged.
  if (!selection) {
    inspectAt(t.tileX, t.tileY);
    return;
  }
  placeSelection(t.tileX, t.tileY);
  // Drag-paint only makes sense for tile selections; entities are
  // discrete placements, not strokes.
  if (selection && (selection.kind === "biome" || selection.kind === "construction")) {
    painting = true;
  }
}

// Open the inspector on the topmost entity covering (tileX, tileY). Edits
// mutate the raw entity in place; the callback rebuilds + flushes the zone
// so the new behavior takes effect and persists like any other edit.
function inspectAt(tileX, tileY) {
  const state = stateGetter();
  const ent = entityAtTile(state?.rawZone?.entities, tileX, tileY);
  if (!ent) { closeEntityInspector(); return; }
  openEntityInspector(ent, {
    title: entityTitle(ent),
    onChange: () => rebuildZone(state),
  });
}

function entityTitle(ent) {
  const sp = getSpecies(ent.species_id);
  if (!sp) return `#${ent.id}`;
  return `${sp.entity_type}: ${sp.name ?? sp.id}`;
}

function onCanvasMouseMove(e) {
  if (!openState) return;
  // Track the cursor for the ghost preview even when we're not in the
  // middle of a paint stroke — the ghost should follow the cursor
  // whenever the editor is open and a selection is active.
  const rect = canvasEl.getBoundingClientRect();
  cursorCssX = e.clientX - rect.left;
  cursorCssY = e.clientY - rect.top;
  if (!painting) return;
  if (!selection || (selection.kind !== "biome" && selection.kind !== "construction")) return;
  const t = canvasEventToTile(e);
  if (!t) return;
  placeSelection(t.tileX, t.tileY);
}

function onCanvasMouseUp() {
  painting = false;
}

function onCanvasContextMenu(e) {
  if (!openState || !isCreativeMode()) return;
  e.preventDefault();
  const t = canvasEventToTile(e);
  if (!t) return;
  eraseTile(t.tileX, t.tileY);
}

// Mutates state.rawZone to apply the current selection at (tileX, tileY)
// then rebuilds state.zone so the change is visible immediately.
function placeSelection(tileX, tileY) {
  if (!selection) return;
  const state = stateGetter();
  if (!state?.rawZone) return;
  const raw = state.rawZone;
  if (selection.kind === "biome") {
    setBiomeChar(raw, tileX, tileY, selection.char);
  } else if (selection.kind === "construction") {
    setConstructionChar(raw, tileX, tileY, selection.char);
  } else if (selection.kind === "species") {
    addEntity(raw, tileX, tileY, selection.id);
  } else {
    return;
  }
  rebuildZone(state);
}

function eraseTile(tileX, tileY) {
  const state = stateGetter();
  if (!state?.rawZone) return;
  const raw = state.rawZone;
  // Erase = NOTHING on the construction layer (matches Rust map_editor's
  // Construction::Nothing payload). Leaves the biome untouched so the
  // floor underneath stays the same.
  setConstructionChar(raw, tileX, tileY, "0");
  // Also drop any non-shipped (editor-added) entity sitting on this tile.
  // Shipped entities have positive ids; editor placements start at -1 and
  // decrement, so this only strips author edits.
  raw.entities = (raw.entities ?? []).filter((e) => {
    if (typeof e.id !== "number" || e.id >= 0) return true;
    const f = e.frame; if (!f) return true;
    const within = tileX >= f.x && tileX < f.x + f.w
                && tileY >= f.y && tileY < f.y + f.h;
    return !within;
  });
  // If we just erased the entity the inspector was editing, drop the panel
  // so it can't mutate a detached object on the next dropdown change.
  const inspected = inspectedEntity();
  if (inspected && !raw.entities.includes(inspected)) closeEntityInspector();
  rebuildZone(state);
}

function setBiomeChar(raw, tileX, tileY, ch) {
  const rows = raw.biome_tiles?.tiles;
  if (!Array.isArray(rows)) return;
  if (tileY < 0 || tileY >= rows.length) return;
  const row = rows[tileY];
  if (typeof row !== "string" || tileX < 0 || tileX >= row.length) return;
  rows[tileY] = row.slice(0, tileX) + ch + row.slice(tileX + 1);
}

function setConstructionChar(raw, tileX, tileY, ch) {
  const rows = raw.construction_tiles?.tiles;
  if (!Array.isArray(rows)) return;
  if (tileY < 0 || tileY >= rows.length) return;
  const row = rows[tileY];
  if (typeof row !== "string" || tileX < 0 || tileX >= row.length) return;
  rows[tileY] = row.slice(0, tileX) + ch + row.slice(tileX + 1);
}

// Stamp a new entity into raw.entities. NPCs use a 1×2 sprite whose
// feet land on the cursor — Rust map_editor offsets frame.y by -1 for
// that. Everything else lands at the cursor's top-left. Buildings get
// the prefab expansion (door teleporter + auto-generated interior zone
// in the IndexedDB buffer); unknown buildings fall through to the
// single-entity path.
function addEntity(raw, tileX, tileY, speciesId) {
  const sp = getSpecies(speciesId);
  if (!sp) return;

  if (sp.entity_type === "Building") {
    const prefab = tryBuildingPrefab(speciesId, raw.id, tileX, tileY);
    if (prefab) {
      raw.entities = raw.entities ?? [];
      for (const e of prefab.entities) raw.entities.push(e);
      // Persist each generated interior zone to the server so the door
      // teleporter resolves on first crossing. Fire-and-forget.
      for (const interior of prefab.interiorZones ?? []) {
        saveEditedWorld(interior.id, interior).catch((err) => {
          console.warn("prefabs: failed to save interior zone", err);
        });
      }
      return;
    }
  }

  const w = Math.max(1, sp.width || 1);
  const h = Math.max(1, sp.height || 1);
  const isNpc = sp.entity_type === "Npc";
  const fy = isNpc ? tileY - 1 : tileY;
  const entity = {
    id: nextEditorEntityId--,
    species_id: speciesId,
    direction: "Down",
    frame: { x: tileX, y: fy, w, h },
    after_dialogue: "Nothing",
    demands_attention: false,
    destination: null,
    dialogues: [],
    display_conditions: [],
    is_consumable: false,
    lock_type: "None",
  };
  raw.entities = raw.entities ?? [];
  raw.entities.push(entity);
}

// Re-derive the runtime zone from the mutated raw JSON. Also flushes
// the override buffer in the background so the edit survives a refresh
// even without an intervening teleport — matches the spec's "Save zone
// (flush to buffer)" semantics, just automatic on every placement.
function rebuildZone(state) {
  const next = buildZone(state.rawZone);
  setupPuzzles(next);
  setupCutscenes(next);
  // Preserve the spawnPoint the player came in on so death respawn still
  // works while the level is being edited.
  if (state.zone?.spawnPoint) next.spawnPoint = state.zone.spawnPoint;
  state.zone = next;
  invalidateZoneCache(state.zone?.id ?? state.rawZone.id);
  if (state.rawZone?.id != null) {
    saveEditedWorld(state.rawZone.id, state.rawZone).catch((err) => {
      console.warn("creative: save flush failed", err);
    });
  }
}

// Ghost preview overlay: a transparent canvas pinned over the game canvas
// that draws the current selection's real sprite at the cursor tile,
// at half opacity. Replaces Rust's red-rectangle placeholder with the
// actual asset the player will see once they click.
function ensureGhostCanvas() {
  if (ghostCanvas) return;
  ghostCanvas = document.createElement("canvas");
  ghostCanvas.id = "map-editor-ghost";
  Object.assign(ghostCanvas.style, {
    position: "fixed",
    pointerEvents: "none",
    imageRendering: "pixelated",
    zIndex: "5",
    display: "none",
  });
  document.body.appendChild(ghostCanvas);
  ghostCtx = ghostCanvas.getContext("2d");
  ghostCtx.imageSmoothingEnabled = false;
}

function startGhostLoop() {
  if (ghostRafId) return;
  const tick = () => {
    if (!openState) { ghostRafId = 0; return; }
    drawGhostFrame();
    ghostRafId = requestAnimationFrame(tick);
  };
  ghostRafId = requestAnimationFrame(tick);
}

function stopGhostLoop() {
  if (!ghostRafId) return;
  cancelAnimationFrame(ghostRafId);
  ghostRafId = 0;
}

function drawGhostFrame() {
  if (!canvasEl || !ghostCanvas || !ghostCtx) return;
  // Mirror the game canvas's bounding rect (CSS) and its drawing-buffer
  // dimensions every frame so the overlay tracks zoom.js's resizes
  // without us subscribing to anything.
  const rect = canvasEl.getBoundingClientRect();
  if (ghostCanvas.width !== canvasEl.width)   ghostCanvas.width  = canvasEl.width;
  if (ghostCanvas.height !== canvasEl.height) ghostCanvas.height = canvasEl.height;
  Object.assign(ghostCanvas.style, {
    left:   `${rect.left}px`,
    top:    `${rect.top}px`,
    width:  `${rect.width}px`,
    height: `${rect.height}px`,
  });
  ghostCtx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);

  const state = stateGetter();
  if (!state?.zone || !selection) { ghostCanvas.style.display = "none"; return; }
  if (cursorCssX < 0 || cursorCssY < 0) { ghostCanvas.style.display = "none"; return; }

  // CSS-pixel cursor → drawing-buffer pixel → tile.
  const bx = (cursorCssX / rect.width)  * canvasEl.width;
  const by = (cursorCssY / rect.height) * canvasEl.height;
  const ox = Math.round(-state.camera.x * TILE_SIZE);
  const oy = Math.round(-state.camera.y * TILE_SIZE);
  const tileX = Math.floor((bx - ox) / TILE_SIZE);
  const tileY = Math.floor((by - oy) / TILE_SIZE);
  if (tileX < 0 || tileY < 0 || tileX >= state.zone.cols || tileY >= state.zone.rows) {
    ghostCanvas.style.display = "none";
    return;
  }
  ghostCanvas.style.display = "block";

  ghostCtx.save();
  ghostCtx.globalAlpha = 0.5;
  try {
    if (selection.kind === "biome")        drawBiomeGhost(tileX, tileY, ox, oy);
    else if (selection.kind === "construction") drawConstructionGhost(tileX, tileY, ox, oy);
    else if (selection.kind === "species") drawSpeciesGhost(tileX, tileY, ox, oy);
  } catch {
    // Sprite sheet not yet loaded — skip this frame, the next will retry.
  }
  ghostCtx.restore();
}

function drawBiomeGhost(tileX, tileY, ox, oy) {
  const sheet = getBiomeSheet();
  if (!sheet) return;
  // Column 0 of the composed sheet is the pure base tile; row = biome id
  // (with the animation frame collapsed to 0 for the preview).
  const sx = 0;
  const sy = selection.id * TILE_SIZE;
  const dx = ox + tileX * TILE_SIZE;
  const dy = oy + tileY * TILE_SIZE;
  ghostCtx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
}

function drawConstructionGhost(tileX, tileY, ox, oy) {
  const sheet = getSprite("tilesConstructions");
  if (!sheet) return;
  // Construction sheet: col = construction id, row 1 = "isolated tile"
  // pattern from constructionTiles.js (matches what an editor stroke
  // will render as before neighbors join up).
  const sx = selection.id * TILE_SIZE;
  const sy = 1 * TILE_SIZE;
  const dx = ox + tileX * TILE_SIZE;
  const dy = oy + tileY * TILE_SIZE;
  ghostCtx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, dx, dy, TILE_SIZE, TILE_SIZE);
}

function drawSpeciesGhost(tileX, tileY, ox, oy) {
  const sp = getSpecies(selection.id);
  if (!sp) return;
  const sheet = getEntitySheet(sp);
  if (!sheet) return;
  // Mirror addEntity's NPC y-offset so the ghost lands where the click
  // would commit it. Otherwise the preview would float one tile off.
  const isNpc = sp.entity_type === "Npc";
  const placeY = isNpc ? tileY - 1 : tileY;
  const w = Math.max(1, sp.width || 1);
  const h = Math.max(1, sp.height || 1);
  const sx = sp.texture_x * TILE_SIZE;
  const sy = sp.texture_y * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;
  const dx = ox + tileX * TILE_SIZE;
  const dy = oy + placeY * TILE_SIZE;
  ghostCtx.drawImage(sheet, sx, sy, sw, sh, dx, dy, sw, sh);
}

function injectStyles() {
  if (document.getElementById("map-editor-styles")) return;
  const css = `
    #map-editor {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 320px; max-width: 40vw;
      background: rgba(20, 20, 20, 0.95);
      color: #eee;
      font-family: monospace;
      font-size: 11px;
      overflow-y: auto;
      z-index: 30;
      padding: 8px 10px;
      border-left: 1px solid #333;
    }
    #map-editor .me-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    #map-editor .me-head .me-hint { color: #888; font-size: 10px; flex: 1; }
    #map-editor .me-close { background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 2px 8px; border-radius: var(--sb-surface-radius); cursor: pointer; }
    #map-editor .me-selection { background: #1f1f1f; border: 1px solid #333;
      border-radius: var(--sb-surface-radius); padding: 6px 8px; margin-bottom: 8px; color: #d8d8d8; }
    #map-editor .me-section { margin-bottom: 10px; }
    #map-editor .me-section h4 { margin: 4px 0; font-size: 11px; color: #aaa;
      letter-spacing: 1px; text-transform: uppercase; }
    #map-editor .me-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    #map-editor .me-cell {
      background: #1f1f1f; color: #ddd; border: 1px solid #2e2e2e;
      border-radius: var(--sb-surface-radius); padding: 4px; cursor: pointer; font-size: 10px;
      text-align: center; min-height: 28px; line-height: 1.1;
      overflow: hidden; text-overflow: ellipsis;
      font-family: inherit;
    }
    #map-editor .me-cell.selected { background: #2a4a2a; border-color: #4a7a4a; color: #fff; }
    #map-editor .me-cell:hover { background: #303030; }
    #map-editor .me-cell.selected:hover { background: #305030; }
    #map-editor .me-cell-entity { padding: 2px; }
    #map-editor .me-icon-wrap {
      display: inline-block; width: 32px; height: 32px; overflow: hidden; position: relative;
    }
    #map-editor .me-icon {
      display: block; width: 16px; height: 16px; position: absolute; left: 0; top: 0;
      background-repeat: no-repeat;
      image-rendering: pixelated;
      transform: scale(2); transform-origin: top left;
    }
  `;
  const style = document.createElement("style");
  style.id = "map-editor-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
