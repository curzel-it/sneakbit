// Ammo HUD: small chip in the top-right showing the kunai inventory icon
// and the player's current count. Pins to the corner so it doesn't fight
// the on-screen joystick (bottom) or the text HUD (top-left). The icon is
// drawn from the dedicated inventory sprite sheet at the species'
// `inventory_texture_offset`, matching the original game's HUD.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getAmmo, onInventoryChange } from "./inventory.js";
import { getSpecies } from "./species.js";

const KUNAI_SPECIES_ID = 7000;
const ICON_PIXELS = 28;

let root = null;
let iconCanvas = null;
let countEl = null;
let lastDrawn = -1;

export function installAmmoHud() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "ammo-hud";
  Object.assign(root.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    padding: "6px 10px",
    background: "rgba(10, 10, 10, 0.7)",
    border: "1px solid #333",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    zIndex: "11",
    pointerEvents: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  });

  iconCanvas = document.createElement("canvas");
  iconCanvas.width = TILE_SIZE;
  iconCanvas.height = TILE_SIZE;
  Object.assign(iconCanvas.style, {
    width: `${ICON_PIXELS}px`,
    height: `${ICON_PIXELS}px`,
    imageRendering: "pixelated",
  });

  countEl = document.createElement("span");
  countEl.textContent = "x0";

  root.appendChild(iconCanvas);
  root.appendChild(countEl);
  document.body.appendChild(root);

  onInventoryChange(updateAmmoHud);
  return root;
}

export function updateAmmoHud() {
  if (!root) return;
  const n = getAmmo(KUNAI_SPECIES_ID);
  if (n !== lastDrawn) {
    countEl.textContent = `x${n}`;
    lastDrawn = n;
  }
  // Lazy-draw the icon the first time the sprite sheet is available
  // (it's loaded async at startup, so the first frames may not have it).
  if (!iconCanvas.dataset.painted) paintIcon();
}

function paintIcon() {
  const sp = getSpecies(KUNAI_SPECIES_ID);
  if (!sp || !sp.inventory_texture_offset) return;
  let sheet;
  try { sheet = getSprite("inventory"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  // `inventory_texture_offset` is [row, col] in the rust source.
  const [row, col] = sp.inventory_texture_offset;
  const ctx = iconCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.drawImage(
    sheet,
    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    0, 0, TILE_SIZE, TILE_SIZE,
  );
  iconCanvas.dataset.painted = "1";
}
