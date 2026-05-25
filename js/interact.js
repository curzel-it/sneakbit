// Player interaction: press E (or Enter) to start a dialogue with the
// entity directly in front of the player. Pauses player updates while
// the dialogue is open via the same isDialogueOpen() gate that main uses.
//
// Also draws an on-screen hint when an interactable is in front of the
// player, so the action is discoverable without reading the README.

import { showDialogue, resolveEntityDialogue, isDialogueOpen } from "./dialogue.js";

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

let stateRef = null;
let hintEl = null;

export function installInteract(getState) {
  stateRef = getState;
  hintEl = makeHint();
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code !== "KeyE" && e.code !== "Enter") return;
    if (isDialogueOpen()) return;
    const state = stateRef();
    if (!state) return;
    const target = findFacingEntity(state.world, state.player);
    if (!target) return;
    const lines = resolveEntityDialogue(target);
    if (!lines) return;
    e.preventDefault();
    showDialogue(lines);
  });
}

export function tickInteract() {
  if (!stateRef || !hintEl) return;
  if (isDialogueOpen()) { hintEl.style.display = "none"; return; }
  const state = stateRef();
  const target = state ? findFacingEntity(state.world, state.player) : null;
  hintEl.style.display = target ? "block" : "none";
}

function makeHint() {
  const el = document.createElement("div");
  el.id = "interact-hint";
  el.textContent = "Press E to talk";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "16%",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "6px 14px",
    background: "rgba(10, 10, 10, 0.85)",
    border: "1px solid #555",
    borderRadius: "12px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "12px",
    display: "none",
    pointerEvents: "none",
    zIndex: "13",
  });
  document.body.appendChild(el);
  return el;
}

function findFacingEntity(world, player) {
  const [dx, dy] = DIR_DELTA[player.direction] ?? [0, 1];
  const tx = player.tileX + dx;
  const ty = player.tileY + dy;
  for (const e of world.entities) {
    if (!e.frame) continue;
    const { x, y, w, h } = e.frame;
    if (tx >= x && tx < x + w && ty >= y && ty < y + h) {
      if ((e.dialogues || []).length > 0) return e;
    }
  }
  return null;
}
