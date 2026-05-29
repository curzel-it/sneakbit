// Player interaction: press E (or Enter) to start a dialogue with the
// entity directly in front of the player. Pauses player updates while
// the dialogue is open via the same isDialogueOpen() gate that main uses.
//
// Also draws an on-screen hint when an interactable is in front of the
// player, so the action is discoverable without reading the README.

import { showDialogue, resolveEntityDialogue, isDialogueOpen } from "./dialogue.js?v=20260529a";
import { handleAfterDialogue } from "./afterDialogue.js?v=20260529a";
import { matchesAction } from "./keyBindings.js?v=20260529a";
import { isCoopMode, isCoopActive, localPlayerCount, COOP_KEYMAPS } from "./coopMode.js?v=20260529a";
import { shouldBeVisible } from "./entityVisibility.js?v=20260529a";
import { getNetRole } from "./onlineBootstrap.js?v=20260529a";

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
    if (isDialogueOpen()) return;
    // Guests don't drive dialogues — the host owns the dialogue modal
    // and broadcasts the resulting event frames back via guestEvents.
    // Letting the local interact handler fire would pop a duplicate
    // dialogue using the guest's lagged local-zone entity list.
    if (getNetRole() === "guest") return;
    const state = stateRef();
    if (!state) return;
    const initiator = pickInitiator(state, e.code);
    if (!initiator) return;
    if (performInteract(state, initiator)) {
      e.preventDefault();
    }
  });
}

// Network injection seam — see shooting.tryShootForSlot for the
// motivation. hostGuests.dispatchActionForSlot calls this directly
// instead of synthesising a KeyboardEvent for the slot's interact key.
export function tryInteractForSlot(slot) {
  if (getNetRole() === "guest") return;
  if (isDialogueOpen()) return;
  const state = stateRef?.();
  if (!state) return;
  const initiator = playerForSlotInState(state, slot);
  if (!initiator) return;
  performInteract(state, initiator);
}

function playerForSlotInState(state, slot) {
  if (slot === 1) return state.player || null;
  if (slot === 2) return (state.player2 && state.player2.playerId) ? state.player2 : null;
  if (!Array.isArray(state.players)) return null;
  const s = state.players.find((e) => e.slot === slot);
  return s ? s.player : null;
}

// Returns true if a dialogue was kicked off (the keyboard handler then
// preventDefault's so the key doesn't double-fire downstream). Returns
// false when there's nothing in front to talk to.
function performInteract(state, initiator) {
  const target = findFacingEntity(state.zone, initiator);
  if (!target) return false;
  const dialogue = resolveEntityDialogue(target);
  if (!dialogue) return false;
  showDialogue(dialogue, initiator.index | 0).then(() => handleAfterDialogue(state.zone, target));
  return true;
}

// Maps a keydown to the player who should act on it. P1 always uses
// the rebindable interact action; P2 only fires when local co-op is on,
// and slots 3/4 cover the host's view of network guests.
function pickInitiator(state, code) {
  if (matchesAction("interact", code, 0)) return state.player;
  if (isCoopMode() && matchesAction("interact", code, 1)) {
    return state.player2 || state.player;
  }
  // Local P3 / P4 keyboard (empty by default) once the count covers them.
  if (localPlayerCount() >= 3 && matchesAction("interact", code, 2)) return playerForSlot(state, 3);
  if (localPlayerCount() >= 4 && matchesAction("interact", code, 3)) return playerForSlot(state, 4);
  if (isCoopActive()) {
    if (code === COOP_KEYMAPS[2]?.interact && state.player2?.playerId) {
      return state.player2;
    }
    for (const slot of [3, 4]) {
      if (code === COOP_KEYMAPS[slot]?.interact) {
        return playerForSlot(state, slot) || state.player;
      }
    }
  }
  return null;
}

function playerForSlot(state, slot) {
  if (!Array.isArray(state.players)) return null;
  const s = state.players.find((e) => e.slot === slot);
  return s ? s.player : null;
}

export function tickInteract() {
  if (!stateRef || !hintEl) return;
  if (isDialogueOpen()) { hintEl.style.display = "none"; return; }
  const state = stateRef();
  const target = state ? findFacingEntity(state.zone, state.player) : null;
  hintEl.style.display = target ? "block" : "none";
}

function makeHint() {
  const el = document.createElement("div");
  el.id = "interact-hint";
  el.textContent = "Press E to talk";
  // Styled to match toast.js exactly so the in-zone interact prompt and
  // pickup/hint toasts are visually consistent (top: 6% band, same
  // background, radius, padding, fontSize). Persistent while a
  // dialogue-bearing entity is in front of the player — main.js calls
  // tickInteract() once per frame to toggle the visibility.
  Object.assign(el.style, {
    position: "fixed",
    top: "6%",
    left: "50%",
    transform: "translateX(-50%)",
    maxWidth: "min(640px, 86vw)",
    padding: "10px 16px",
    background: "rgba(10, 10, 10, 0.92)",
    border: "1px solid #444",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "14px",
    lineHeight: "1.4",
    textAlign: "center",
    display: "none",
    pointerEvents: "none",
    zIndex: "13",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
  });
  document.body.appendChild(el);
  return el;
}

function findFacingEntity(zone, player) {
  const [dx, dy] = DIR_DELTA[player.direction] ?? [0, 1];
  const tx = player.tileX + dx;
  const ty = player.tileY + dy;
  for (const e of zone.entities) {
    if (!e.frame) continue;
    if (!shouldBeVisible(e)) continue;
    const { x, y, w, h } = e.frame;
    if (tx >= x && tx < x + w && ty >= y && ty < y + h) {
      if ((e.dialogues || []).length > 0) return e;
    }
  }
  return null;
}
