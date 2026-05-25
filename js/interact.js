// Player interaction: press E (or Enter) to start a dialogue with the
// entity directly in front of the player. Pauses player updates while
// the dialogue is open via the same isDialogueOpen() gate that main uses.

import { showDialogue, resolveEntityDialogue, isDialogueOpen } from "./dialogue.js";

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

let stateRef = null;

export function installInteract(getState) {
  stateRef = getState;
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
