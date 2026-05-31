// Quick weapon-switch: a single input equips the next/previous weapon in
// one slot, live (no pause), with a brief screen-centered ribbon for
// feedback. Ranged and melee are independent slots with their own
// prev/next bindings (the only model that fits a game where both slots
// are equipped at once and fired by different keys). The ranged shoulder
// pair (RB/LB) makes this most useful on a controller — there's otherwise
// no fast way to re-equip without opening the pause menu.
//
// Equipping is a bare setEquipped(): host/guest loadout sync both listen
// on onEquipmentChange, so a local switch propagates in every mode with
// no extra wiring here.

import { weaponsInSlot, nextWeaponInSlot } from "./weaponSlots.js";
import { setEquipped, SLOT_RANGED, SLOT_MELEE } from "./equipment.js";
import { resolveAction } from "./keyBindings.js";
import { localPlayerCount } from "./coopMode.js";
import { isPvp } from "./gameMode.js";
import { isPlayerDead } from "./playerHealth.js";
import { getSpecies } from "./species.js";
import { tr } from "./strings.js";
import { getSprite } from "./assets.js";
import { TILE_SIZE } from "./constants.js";

// action id → [slot, direction]
const ACTION_MAP = {
  rangedNext: [SLOT_RANGED, +1],
  rangedPrev: [SLOT_RANGED, -1],
  meleeNext:  [SLOT_MELEE,  +1],
  meleePrev:  [SLOT_MELEE,  -1],
};

const RIBBON_MS = 1500;
const FADE_MS = 200;

// Whether an overlay (pause menu, dialogue, …) is up — a stray Tab behind
// the menu shouldn't silently swap your gun. Injected by main.js, which
// already owns that set, so this feature doesn't reach into six UI modules.
let isBlocked = () => false;

// Equip the next/previous weapon in `slot` for the given local player.
// No-op in PvP, while dead, while an overlay is open, or when the slot has
// fewer than 2 weapons.
export function cycleWeapon(slot, playerIndex = 0, dir = +1) {
  if (isPvp()) return;
  if (isBlocked()) return;
  if (isPlayerDead(playerIndex)) return;
  const id = nextWeaponInSlot(slot, playerIndex, dir);
  if (id == null) return;
  setEquipped(slot, id, playerIndex); // sync handled via onEquipmentChange
  showWeaponRibbon(slot, playerIndex);
}

let installed = false;

// blockedFn: () => boolean — true while a blocking overlay is open.
export function installWeaponSelect(blockedFn) {
  if (typeof blockedFn === "function") isBlocked = blockedFn;
  if (installed) return;
  installed = true;
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKey);
}

function onKey(e) {
  if (e.repeat) return; // edge-trigger: ignore OS auto-repeat so holding doesn't spin
  if (isBlocked()) return;
  const r = resolveAction(e.code);
  if (!r) return;
  const map = ACTION_MAP[r.action];
  if (!map) return;
  // Only route to a local player slot that's actually active (same gate as input.js).
  if (r.playerIndex >= 1 && (r.playerIndex + 1) > localPlayerCount()) return;
  e.preventDefault(); // Tab must not walk DOM focus
  cycleWeapon(map[0], r.playerIndex, map[1]);
}

// ---- ribbon ----------------------------------------------------------

let root = null;
let stripEl = null;
let labelEl = null;
let hideTimer = null;
let fadeTimer = null;

function ensureRibbon() {
  if (root || typeof document === "undefined") return root;
  injectStyles();
  root = document.createElement("div");
  root.id = "weapon-switch";
  stripEl = document.createElement("div");
  stripEl.className = "ws-strip";
  labelEl = document.createElement("div");
  labelEl.className = "ws-label";
  root.appendChild(stripEl);
  root.appendChild(labelEl);
  document.body.appendChild(root);
  return root;
}

function showWeaponRibbon(slot, playerIndex) {
  if (!ensureRibbon()) return;
  const list = weaponsInSlot(slot, playerIndex);
  if (!list.length) return;

  stripEl.replaceChildren();
  let active = null;
  for (const entry of list) {
    if (entry.isEquipped) active = entry;
    const cell = document.createElement("div");
    cell.className = "ws-cell" + (entry.isEquipped ? " is-active" : "");
    const icon = document.createElement("canvas");
    icon.width = TILE_SIZE;
    icon.height = TILE_SIZE;
    cell.appendChild(icon);
    stripEl.appendChild(cell);
    paintIcon(icon, entry.species);
  }

  const name = active ? (tr(active.species?.name) || active.species?.name || `#${active.id}`) : "";
  labelEl.textContent = (active && active.ammo != null) ? `${name} · x${active.ammo}` : name;

  clearTimers();
  root.style.display = "flex";
  void root.offsetWidth; // reflow so the fade-in starts from opacity 0
  root.style.opacity = "1";
  hideTimer = setTimeout(() => {
    root.style.opacity = "0";
    fadeTimer = setTimeout(() => { root.style.display = "none"; }, FADE_MS);
  }, RIBBON_MS);
}

function clearTimers() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
}

// Blit a species' inventory icon. inventory_texture_offset is [row, col]
// (same convention as ammoHud.js / pickups.js).
function paintIcon(canvas, species) {
  const off = species?.inventory_texture_offset;
  if (!off) return;
  let sheet;
  try { sheet = getSprite("inventory"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  const [row, col] = off;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.drawImage(sheet, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
}

function injectStyles() {
  if (document.getElementById("weapon-switch-styles")) return;
  const style = document.createElement("style");
  style.id = "weapon-switch-styles";
  style.textContent = `
    #weapon-switch {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 15;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 14px 18px;
      background: var(--sb-surface-bg, rgba(10,10,10,0.92));
      border: var(--sb-surface-border, 1px solid #444);
      border-radius: var(--sb-surface-radius, 8px);
      color: var(--sb-text, #eee);
      font-family: var(--sb-font, monospace);
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
      opacity: 0;
      transition: opacity ${FADE_MS}ms ease;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    }
    #weapon-switch .ws-strip { display: flex; gap: 8px; }
    #weapon-switch .ws-cell {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid transparent;
      border-radius: 6px;
      opacity: 0.55;
    }
    #weapon-switch .ws-cell.is-active {
      opacity: 1;
      border-color: var(--sb-accent, #ffd34d);
      background: rgba(255,255,255,0.08);
    }
    #weapon-switch .ws-cell canvas {
      width: 32px;
      height: 32px;
      image-rendering: pixelated;
    }
    #weapon-switch .ws-label { font-size: 14px; }
  `;
  document.head.appendChild(style);
}
