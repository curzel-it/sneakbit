// Ammo HUD: small chip in the top-right showing the kunai inventory icon
// and the player's current count. Pins to the corner so it doesn't fight
// the on-screen joystick (bottom) or the HP HUD (top-left). The icon is
// drawn from the dedicated inventory sprite sheet at the species'
// `inventory_texture_offset`, matching the original game's HUD.
//
// Local co-op shares the kunai pool (inventory.js folds P2 onto P1), so
// a single chip covers both players. Network co-op also renders the
// local hero's chip only — the host's HUD doesn't try to show guests'
// counts.

import { TILE_SIZE } from "./constants.js?v=20260527";
import { getSprite } from "./assets.js?v=20260527";
import { getAmmo, onInventoryChange } from "./inventory.js?v=20260527";
import { getSpecies } from "./species.js?v=20260527";
const KUNAI_SPECIES_ID = 7000;
const ICON_PIXELS = 28;

let root = null;
const chips = []; // [{ icon, count, lastDrawn, index }]

export function installAmmoHud() {
  if (root) return root;
  injectStyles();
  root = document.createElement("div");
  root.id = "ammo-hud";
  Object.assign(root.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "6px",
    zIndex: "11",
    pointerEvents: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  });

  chips.push(makeChip(0));
  for (const c of chips) root.appendChild(c.root);
  document.body.appendChild(root);

  onInventoryChange(updateAmmoHud);
  return root;
}

function makeChip(index) {
  const card = document.createElement("div");
  Object.assign(card.style, {
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
  });

  const icon = document.createElement("canvas");
  icon.width = TILE_SIZE;
  icon.height = TILE_SIZE;
  Object.assign(icon.style, {
    width: `${ICON_PIXELS}px`,
    height: `${ICON_PIXELS}px`,
    imageRendering: "pixelated",
  });

  const count = document.createElement("span");
  count.textContent = `x0`;

  card.appendChild(icon);
  card.appendChild(count);
  return { root: card, icon, count, lastDrawn: -1, index };
}

export function updateAmmoHud() {
  if (!root) return;
  for (const c of chips) {
    const n = getAmmo(KUNAI_SPECIES_ID, c.index);
    if (n !== c.lastDrawn) {
      c.count.textContent = `x${n}`;
      c.lastDrawn = n;
    }
    // Lazy-draw the icon the first time the sprite sheet is available
    // (it's loaded async at startup, so the first frames may not have it).
    if (!c.icon.dataset.painted) paintIcon(c.icon);
  }
}

function injectStyles() {
  if (document.getElementById("ammo-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "ammo-hud-styles";
  style.textContent = `
    body.touch-mode #ammo-hud { right: 62px; }
  `;
  document.head.appendChild(style);
}

function paintIcon(iconCanvas) {
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
