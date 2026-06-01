// Ammo HUD: small chip in the top-right showing the inventory icon and the
// player's current count. Pins to the corner so it doesn't fight the on-screen
// joystick (bottom) or the HP HUD (top-left). The icon is drawn from the
// dedicated inventory sprite sheet at the species' `inventory_texture_offset`,
// matching the original game's HUD.
//
// Single-slice (single-player / online): one chip, top-right, for the local
// hero. In split-screen local play (co-op or PvP) one chip per player is
// anchored to the top-right of THAT player's slice — mirroring the per-slice
// HP bars — each showing that player's own count.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getAmmo, onInventoryChange } from "./inventory.js";
import { getEquipped, SLOT_RANGED, onEquipmentChange } from "./equipment.js";
import { getSpecies } from "./species.js";
import { isPvp } from "./gameMode.js";
import { localPlayerCount } from "./coopMode.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { getPvpAmmo, getPvpRangedWeapon, bulletOfWeapon } from "./pvpLoadout.js";
const KUNAI_SPECIES_ID = 7000;
const ICON_PIXELS = 28;
const MAX_PLAYERS = 4;

let root = null;
const chips = []; // [{ root, icon, count, lastLabel, iconSpecies, index }]

export function installAmmoHud() {
  if (root) return root;
  injectStyles();
  root = document.createElement("div");
  root.id = "ammo-hud";

  // Build all four chips up front; updateAmmoHud shows only the active ones
  // (the local player count is hot-toggled, so we can't size the set here).
  for (let i = 0; i < MAX_PLAYERS; i++) chips.push(makeChip(i));
  for (const c of chips) root.appendChild(c.root);
  document.body.appendChild(root);

  onInventoryChange(updateAmmoHud);
  onEquipmentChange(updateAmmoHud); // chip follows the equipped ranged weapon
  return root;
}

// The bullet the player's equipped ranged weapon fires (story/co-op).
// Falls back to the kunai when no weapon resolves (default loadout / tests).
function rangedBulletFor(playerIndex) {
  const sp = getSpecies(getEquipped(SLOT_RANGED, playerIndex));
  return sp?.bullet_species_id || KUNAI_SPECIES_ID;
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
  const pvp = isPvp();
  // Split-screen local play shows one chip per player, each anchored to its
  // own slice and reading its own count. Single-slice (single-player / online)
  // shows just the local hero's chip in the shared top-right corner.
  const split = sliceCount() > 1;
  const slices = split ? getSlices() : null;
  const count = split ? localPlayerCount() : 1;
  // Tag with the player number when more than one chip is on screen, or in
  // PvP (where the chip tracks a specific player's scavenged loadout).
  const tagged = pvp || count > 1;
  for (const c of chips) {
    if (c.index >= count) { c.root.style.display = "none"; continue; }
    c.root.style.display = "";
    // PvP draws from the per-player scavenge loadout and follows that player's
    // equipped caliber; outside PvP it's the persisted inventory pool.
    const bulletId = pvp
      ? bulletOfWeapon(getPvpRangedWeapon(c.index))
      : rangedBulletFor(c.index);
    const n = pvp ? getPvpAmmo(c.index, bulletId) : getAmmo(bulletId, c.index);
    const label = tagged ? `P${c.index + 1}  x${n}` : `x${n}`;
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
    anchorChip(c, slices);
  }
}

// Position one chip: fixed to the top-right of its slice in split-screen, or
// reset to the shared top-right container flow (single-slice). Mirrors
// healthHud.anchorBar, but right-aligned (translateX) since ammo pins right.
function anchorChip(c, slices) {
  const css = slices?.[c.index]?.cssRect;
  if (css) {
    Object.assign(c.root.style, {
      position: "fixed",
      left: `${Math.round(css.left + css.width - 12)}px`,
      top: `${Math.round(css.top + 12)}px`,
      transform: "translateX(-100%)",
    });
  } else {
    Object.assign(c.root.style, { position: "", left: "", top: "", transform: "" });
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
