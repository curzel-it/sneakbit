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

import { TILE_SIZE } from "./constants.js?v=20260531c";
import { getSprite } from "./assets.js?v=20260531c";
import { getAmmo, onInventoryChange } from "./inventory.js?v=20260531c";
import { getSpecies } from "./species.js?v=20260531c";
import { isPvp } from "./gameMode.js?v=20260531c";
import { cameraPlayerIndex } from "./pvpMatch.js?v=20260531c";
import { getPvpAmmo, getPvpRangedWeapon, bulletOfWeapon } from "./pvpLoadout.js?v=20260531c";
const KUNAI_SPECIES_ID = 7000;
const ICON_PIXELS = 28;

let root = null;
const chips = []; // [{ icon, count, lastDrawn, index }]

export function installAmmoHud() {
  if (root) return root;
  injectStyles();
  root = document.createElement("div");
  root.id = "ammo-hud";

  chips.push(makeChip(0));
  for (const c of chips) root.appendChild(c.root);
  document.body.appendChild(root);

  onInventoryChange(updateAmmoHud);
  return root;
}

function makeChip(index) {
  const card = document.createElement("div");
  card.className = "ammo-chip";

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
  return { root: card, icon, count, lastLabel: null, iconSpecies: -1, index };
}

export function updateAmmoHud() {
  if (!root) return;
  // PvP repurposes the single chip to show the *active* player's ammo for
  // their *currently equipped* ranged weapon — tagged with the player
  // number, with the icon following the equipped caliber. Outside PvP it's
  // the local hero's shared/persisted kunai count as before.
  const pvp = isPvp();
  const activeIdx = pvp ? (cameraPlayerIndex() ?? 0) : 0;
  const bulletId = pvp ? bulletOfWeapon(getPvpRangedWeapon(activeIdx)) : KUNAI_SPECIES_ID;
  for (const c of chips) {
    const n = pvp ? getPvpAmmo(activeIdx, bulletId) : getAmmo(KUNAI_SPECIES_ID, c.index);
    const label = pvp ? `P${activeIdx + 1}  x${n}` : `x${n}`;
    if (label !== c.lastLabel) {
      c.count.textContent = label;
      c.lastLabel = label;
    }
    // Re-paint the icon when the displayed caliber changes (weapon swap).
    if (c.iconSpecies !== bulletId) {
      c.iconSpecies = bulletId;
      c.icon.dataset.painted = "";
    }
    // Lazy-draw the icon the first time the sprite sheet is available
    // (it's loaded async at startup, so the first frames may not have it).
    if (!c.icon.dataset.painted) paintIcon(c.icon, bulletId);
  }
}

function injectStyles() {
  if (document.getElementById("ammo-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "ammo-hud-styles";
  // Positioning + layout lives here (not inline) so the touch-mode rule
  // below can actually shift the chip left of the menu button. Inline
  // style.right beats a class selector, which used to silently neuter
  // the touch-mode shift and stacked the ☰ button on top of the chip.
  style.textContent = `
    #ammo-hud {
      position: fixed;
      top: 12px;
      right: 12px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      z-index: 11;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .ammo-chip {
      padding: 6px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    /* Touch-mode shift clears the ☰ menu button at top-right. The menu
       button is 56px wide pinned at right:12px (its rendered size — the
       .touch-menu CSS attempts width:44px but a later .touch-btn rule
       wins on specificity), so 12+56+8 = 76px gives a comfortable gap. */
    body.touch-mode #ammo-hud { right: 76px; }
  `;
  document.head.appendChild(style);
}

function paintIcon(iconCanvas, speciesId = KUNAI_SPECIES_ID) {
  const sp = getSpecies(speciesId);
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
