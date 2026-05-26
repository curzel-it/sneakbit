// Fast travel. Mirrors Rust features/fast_travel.rs.
//
// Each FastTravelLink entity (species 1185, entity_type FastTravelLink)
// is a stationary world prop the player can walk up to. When the player
// is adjacent to a link AND facing it AND moving, we open a modal that
// lists the worlds they've already visited; picking one teleports them
// to that world's matching FastTravelLink entrance tile.
//
// Visited-world tracking piggybacks on the existing storage.js k/v
// store (key "did_visit.<worldId>"). main.js records a visit on every
// world change. A destination requires ≥ 4 distinct visited worlds to
// unlock at all — same threshold as the Rust source.

import { getValue, setValue } from "./storage.js";
import { travelTo } from "./transitions.js";

const FAST_TRAVEL_SPECIES_ID = 1185;
const UNLOCK_THRESHOLD = 4;
const PROXIMITY = 1.2; // tiles between player centre and link entrance

// World ids correspond to the FastTravelDestination enum in Rust.
const DESTINATIONS = [
  { worldId: 1001, name: "Evergrove" },
  { worldId: 1003, name: "Aridreach" },
  { worldId: 1006, name: "Thermoria" },
  { worldId: 1008, name: "Maritide" },
  { worldId: 1011, name: "Duskhaven" },
  { worldId: 1012, name: "Vintoria" },
  { worldId: 1020, name: "Peak Level" },
];

let root = null;
let open = false;
let stateRef = null;
let cooldown = 0; // after using the menu, don't re-open immediately

export function installFastTravel(getState) {
  stateRef = getState;
  ensureRoot();
  markVisited(getState()?.world?.id);
}

export function isFastTravelOpen() { return open; }

export function markVisited(worldId) {
  if (!worldId) return;
  setValue(`did_visit.${worldId}`, 1);
}

export function tickFastTravel(dt) {
  if (open) return;
  if (cooldown > 0) { cooldown = Math.max(0, cooldown - dt); return; }
  const state = stateRef?.();
  if (!state?.world || !state.player) return;
  if (!hasUnlocked()) return;
  // Either player can stand on a fast-travel link in co-op. Mirrors Rust
  // features/fast_travel.rs iterating live players.
  const link = findLinkNearPlayer(state.world, state.player)
    || (state.player2 && findLinkNearPlayer(state.world, state.player2));
  if (!link) return;
  showFastTravelMenu(state);
}

function hasUnlocked() {
  let visited = 0;
  for (const d of DESTINATIONS) {
    if (getValue(`did_visit.${d.worldId}`)) visited++;
  }
  return visited >= UNLOCK_THRESHOLD;
}

// True when player's centre is within PROXIMITY of the link's entrance
// (link.x + 1, link.y + link.h, matching Rust fast_travel_entrance) AND
// the player is facing toward the link.
function findLinkNearPlayer(world, player) {
  if (!world.entities) return null;
  const pcx = player.x + 0.5;
  const pcy = player.y + 0.5;
  for (const e of world.entities) {
    if (e.species_id !== FAST_TRAVEL_SPECIES_ID) continue;
    const f = e.frame;
    if (!f) continue;
    const ex = f.x + 1;          // entrance x (matches Rust offset)
    const ey = f.y + (f.h || 2); // entrance y (one row below the link)
    const dx = ex + 0.5 - pcx;
    const dy = ey + 0.5 - pcy;
    if (Math.sqrt(dx * dx + dy * dy) > PROXIMITY) continue;
    if (!facingToward(player.direction, dx, dy)) continue;
    return e;
  }
  return null;
}

function facingToward(dir, dx, dy) {
  switch (dir) {
    case "up":    return dy < -0.25;
    case "down":  return dy >  0.25;
    case "left":  return dx < -0.25;
    case "right": return dx >  0.25;
  }
  return false;
}

function ensureRoot() {
  if (root) return;
  root = document.createElement("div");
  root.id = "fast-travel";
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.7)",
    zIndex: "22",
    color: "#dfe7ff",
    fontFamily: "monospace",
  });
  document.body.appendChild(root);
  injectStyles();
}

function showFastTravelMenu(state) {
  const currentWorld = state.world.id;
  const choices = DESTINATIONS.filter(d =>
    d.worldId !== currentWorld && getValue(`did_visit.${d.worldId}`)
  );
  if (choices.length === 0) return;
  open = true;
  root.innerHTML = `
    <div class="ft-card">
      <h1>Fast Travel</h1>
      <ul class="ft-list">
        ${choices.map(c =>
          `<li><button data-world="${c.worldId}">${c.name} <span>· world ${c.worldId}</span></button></li>`
        ).join("")}
      </ul>
      <div class="ft-actions"><button id="ft-cancel">Cancel</button></div>
    </div>
  `;
  root.style.display = "flex";
  root.querySelector("#ft-cancel").addEventListener("click", () => closeMenu());
  for (const btn of root.querySelectorAll("[data-world]")) {
    btn.addEventListener("click", () => {
      const worldId = parseInt(btn.dataset.world, 10);
      pickDestination(state, worldId);
    });
  }
}

function closeMenu() {
  open = false;
  root.style.display = "none";
  cooldown = 0.8;
}

async function pickDestination(state, worldId) {
  const choice = DESTINATIONS.find(d => d.worldId === worldId);
  if (!choice) { closeMenu(); return; }
  closeMenu();
  // Drop the player at this world's own FastTravelLink entrance. We
  // can't know that target world's layout from here, so the resolveSpawn
  // logic in transitions.js (which falls back to the back-teleporter or
  // the world centre) handles it once the world is loaded.
  await travelTo(state, { world: worldId, x: 0, y: 0, direction: "Down" });
}

function injectStyles() {
  if (document.getElementById("fast-travel-styles")) return;
  const css = `
    #fast-travel .ft-card {
      background: #161b2b;
      border: 1px solid #2c3654;
      border-radius: 8px;
      padding: 22px 28px;
      min-width: 320px;
    }
    #fast-travel h1 { margin: 0 0 14px; font-size: 16px; letter-spacing: 2px; color: #b8c6ff; }
    #fast-travel .ft-list { list-style: none; padding: 0; margin: 0 0 16px; }
    #fast-travel .ft-list li { margin: 6px 0; }
    #fast-travel .ft-list button {
      width: 100%; text-align: left; background: #1d2440; color: #dfe7ff;
      border: 1px solid #303a60; padding: 8px 12px; border-radius: 4px;
      cursor: pointer; font-family: inherit;
    }
    #fast-travel .ft-list button:hover { background: #2a345a; }
    #fast-travel .ft-list span { color: #7080b0; font-size: 11px; }
    #fast-travel .ft-actions { text-align: right; }
    #fast-travel #ft-cancel {
      background: #1d2440; color: #dfe7ff; border: 1px solid #303a60;
      padding: 6px 14px; border-radius: 4px; cursor: pointer;
      font-family: inherit;
    }
    #fast-travel #ft-cancel:hover { background: #2a345a; }
  `;
  const style = document.createElement("style");
  style.id = "fast-travel-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
