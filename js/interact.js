// Player interaction: press E (or Enter) to start a dialogue with the
// entity directly in front of the player. Pauses player updates while
// the dialogue is open via the same isDialogueOpen() gate that main uses.
//
// Also draws an on-screen hint when an interactable is in front of the
// player, so the action is discoverable without reading the README.

import { showDialogue, resolveEntityDialogue, isDialogueOpen, speakerNameForEntity } from "./dialogue.js";
import { handleAfterDialogue } from "./afterDialogue.js";
import { openShop, isShopOpen } from "./shop.js";
import { matchesAction } from "./keyBindings.js";
import { isCoopMode, isCoopActive, localPlayerCount, COOP_KEYMAPS } from "./coopMode.js";
import { glyphForAction } from "./inputGlyphs.js";
import { getActiveInputDevice } from "./activeInputDevice.js";
import { tr } from "./strings.js";
import { shouldBeVisible } from "./entityVisibility.js";
import { getNetRole } from "./onlineBootstrap.js";
import { isDying } from "./deathAnimation.js";
import { isVanishing } from "./vanishEffect.js";
import { isWalkable } from "./zone.js";
import { getSpecies } from "./species.js";
import { el } from "./dom.js";

const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// Turn an NPC to face whoever just started talking to it. The initiator is
// pointed straight at the target — findFacingEntity walked along its facing
// to reach it — so the target faces back the opposite way. Mirrors the Rust
// core's npc update, which set the npc's direction toward the hero on the
// confirmation key. The renderer reads e.direction next frame; the host
// ships it to guests in the entity snapshot. No-op for an unknown facing.
export function faceTargetAtInitiator(target, initiator) {
  const face = OPPOSITE[initiator?.direction];
  if (face) target.direction = face;
}

let stateRef = null;
let hintEl = null;

export function installInteract(getState) {
  stateRef = getState;
  hintEl = makeHint();
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (isDialogueOpen() || isShopOpen()) return;
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

// Resolve the entity's dialogue, open it, run its after-dialogue behavior on
// close, and (for a local initiator carrying shop_stock) pop the shop once the
// greeting closes. Returns the showDialogue promise, or null when no dialogue
// matches the current game state. Shared by manual interact (below) and the
// NPC-initiated interception cutscene (npcInterception.js).
export function openDialogueWithEntity(state, initiator, target, { local = false } = {}) {
  const dialogue = resolveEntityDialogue(target);
  if (!dialogue) return null;
  const speaker = speakerNameForEntity(target);
  return showDialogue(dialogue, initiator.index | 0, speaker).then(() => {
    handleAfterDialogue(state.zone, target);
    // A clerk carrying shop_stock opens the buy screen once the greeting
    // closes (Pokémon-mart cadence). Local players only — a host driving a
    // remote guest's interact shouldn't pop the modal on the host's screen.
    if (local && Array.isArray(target.shop_stock) && target.shop_stock.length) {
      openShop(target.shop_stock, initiator.index | 0);
    }
  });
}

// Returns true if a dialogue was kicked off (the keyboard handler then
// preventDefault's so the key doesn't double-fire downstream). Returns
// false when there's nothing in front to talk to.
function performInteract(state, initiator) {
  // A frozen hero (mid-interception cutscene) can't start its own dialogue.
  if (initiator?._frozen) return false;
  const target = findFacingEntity(state.zone, initiator);
  if (!target) return false;
  faceTargetAtInitiator(target, initiator);
  const local = initiator === state.player || initiator === state.player2;
  return openDialogueWithEntity(state, initiator, target, { local }) != null;
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

// Per-frame interaction-prompt update. Returns the label the on-screen touch
// interact button should show, or null to hide it — main.js forwards this to
// touch.setInteractPrompt so the button only appears when there's actually
// something in front to talk to. On touch the labelled button *is* the
// affordance, so the top banner (which reads "Press E…", keyboard-centric and
// meaningless on a phone) stays suppressed; keyboard/gamepad keep the banner.
export function tickInteract() {
  if (!stateRef || !hintEl) return null;
  if (isDialogueOpen()) { hintEl.style.display = "none"; return null; }
  const state = stateRef();
  const target = state ? findFacingEntity(state.zone, state.player) : null;
  if (!target) { hintEl.style.display = "none"; return null; }
  if (getActiveInputDevice() === "touch") {
    hintEl.style.display = "none";
    return tr("hud.interact.talk");
  }
  // Show the prompt with the active device's glyph (e.g. "Press E" /
  // "Press Ⓐ"). Recomputed while visible so it tracks device switches.
  hintEl.textContent = `Press ${glyphForAction("interact", 0)} to talk`;
  hintEl.style.display = "block";
  return null;
}

function makeHint() {
  // Styled to match toast.js exactly so the in-zone interact prompt and
  // pickup/hint toasts are visually consistent (top: 6% band, same
  // background, radius, padding, fontSize). Persistent while a
  // dialogue-bearing entity is in front of the player — main.js calls
  // tickInteract() once per frame to toggle the visibility.
  const node = el("div", {
    id: "interact-hint",
    text: "Press E to talk",
    style: {
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
    },
  });
  document.body.appendChild(node);
  return node;
}

// How far the interact ray reaches past the player. The tile directly in
// front is always probed; each further tile is only reached if the tile
// before it is non-walkable — i.e. you can talk to a clerk across a counter
// but not across open floor. Mirrors the Rust core's "reach over the
// counter" behaviour (is_around_and_pointed_at over a blocked tile).
const MAX_REACH = 3;

export function findFacingEntity(zone, player) {
  const [dx, dy] = DIR_DELTA[player.direction] ?? [0, 1];
  for (let step = 1; step <= MAX_REACH; step++) {
    const tx = player.tileX + dx * step;
    const ty = player.tileY + dy * step;
    const hit = dialogueEntityAt(zone, tx, ty);
    if (hit) return hit;
    // Stop reaching once we hit walkable ground: an empty floor tile means
    // there's nothing to reach over, so a clerk further down isn't in range.
    if (isWalkable(zone, tx, ty)) break;
  }
  return null;
}

function dialogueEntityAt(zone, tx, ty) {
  for (const e of zone.entities) {
    if (!e.frame) continue;
    if (!shouldBeVisible(e)) continue;
    // An NPC mid-vanish (death-anim effect, or fading vanish strip) or
    // walking to an exit shouldn't re-open its dialogue if the player faces
    // it again before it's gone.
    if (isDying(e) || isVanishing(e) || e._walkAway) continue;
    // Hint signs carry a `dialogues` array, but it's the walk-over toast
    // text (handled in pickups.js) — they're proximity-triggered and have
    // no talk affordance, so they must not light up the interact prompt.
    if (getSpecies(e.species_id)?.entity_type === "Hint") continue;
    const { x, y, w, h } = e.frame;
    if (tx >= x && tx < x + w && ty >= y && ty < y + h) {
      if ((e.dialogues || []).length > 0) return e;
    }
  }
  return null;
}
