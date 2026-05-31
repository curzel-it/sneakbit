// Dialogue overlay. HTML element above the canvas with the current line.
// Advances on Space / Enter / Click. While open, the player is paused.
//
// Two payload shapes are supported:
//   - Legacy array of strings (already-resolved lines, no reward tracking)
//   - Rust-style Dialogue object: { text, key, expected_value, reward }.
//     On close, marks dialogue_read.<text>=1 and (if reward set + not yet
//     collected) adds the reward to inventory and shows a toast.

import { tr } from "./strings.js";
import { playSfx } from "./audio.js";
import { getValue, setValue, keyMatches } from "./storage.js";
import { addAmmo } from "./inventory.js";
import { showToast } from "./toast.js";
import { getSpecies } from "./species.js";
import { matchesAction } from "./keyBindings.js";
import { registerMenuSurface } from "./menuNav.js";
import { broadcastHostEvent } from "./hostEvents.js";

let root = null;
let active = null; // { lines, idx, resolve, dialogue }
let listener = null;

export function installDialogue() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "dialogue";
  Object.assign(root.style, {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "5%",
    maxWidth: "min(720px, 90vw)",
    minWidth: "min(400px, 80vw)",
    padding: "16px 20px",
    background: "rgba(10, 10, 10, 0.92)",
    border: "1px solid #444",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "14px",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
    display: "none",
    zIndex: "15",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    cursor: "pointer",
  });
  root.innerHTML = `<div id="dialogue-text"></div><div id="dialogue-hint">▾ space / enter / click</div>`;
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.textContent = `
    #dialogue-hint { color: #888; font-size: 11px; margin-top: 8px; text-align: right; }
    /* On touch devices the on-screen joystick sits at the bottom; flip
       the modal dialogue to the top so it doesn't cover the controls. */
    @media (pointer: coarse) {
      #dialogue { bottom: auto !important; top: 6% !important; }
    }
  `;
  document.head.appendChild(style);

  listener = (e) => {
    if (!active) return;
    // Guest mirror is read-only — the host drives advance/close via
    // event:dialogueAdvance/Close, and the guest's local keypresses
    // would advance only their own copy, desyncing immediately.
    if (active.isNetwork) return;
    // Always accept Space as a universal "advance" so the dialogue
    // remains dismissable even if the player rebinds interact onto an
    // unusual key. Otherwise the rebound interact key works too.
    if (e.code === "Space" || matchesAction("interact", e.code)) {
      e.preventDefault();
      advance();
    }
  };
  window.addEventListener("keydown", listener);
  root.addEventListener("click", () => {
    if (active?.isNetwork) return;
    advance();
  });
  // Controller A advances the dialogue (keyboard Space/interact already do).
  // No focus list — it's advance-only — so register an explicit onConfirm.
  registerMenuSurface({
    isOpen: isDialogueOpen,
    onConfirm: () => { if (!active?.isNetwork) advance(); },
    priority: 20,
  });
  return root;
}

export function isDialogueOpen() { return active !== null; }

export function showDialogue(payload, playerIndex = 0) {
  return new Promise((resolve) => {
    const dialogue = isDialogueObject(payload) ? payload : null;
    const rawLines = dialogue ? [dialogue.text] : (Array.isArray(payload) ? payload : [payload]);
    const lines = rawLines.flatMap(splitOnSeparator).map((s) => tr(s));
    active = { lines, idx: 0, resolve, dialogue, playerIndex: playerIndex | 0 };
    paint();
    root.style.display = "block";
    playSfx("hintReceived", { volume: 0.5 });
    // Mirror to guests with the already-localized lines so they don't
    // need their own dialogue/reward resolution. Idx starts at 0 to
    // match the host's freshly-painted state.
    broadcastHostEvent("dialogueOpen", { lines, idx: 0 });
  });
}

// Guest-side entry point. Driven by event:dialogueOpen from the host.
// Reuses the same DOM but flags `isNetwork:true` so local keys/clicks
// can't advance it — only event:dialogueAdvance/Close from the host
// move the state forward.
export function showNetworkDialogue(lines) {
  if (!root) return;
  if (!Array.isArray(lines) || lines.length === 0) return;
  active = {
    lines: lines.slice(),
    idx: 0,
    resolve: null,
    dialogue: null,
    playerIndex: 0,
    isNetwork: true,
  };
  paint();
  root.style.display = "block";
  playSfx("hintReceived", { volume: 0.5 });
}

// Guest-side: set the displayed line index. No-op unless a network
// dialogue is currently active.
export function advanceNetworkDialogue(idx) {
  if (!active || !active.isNetwork) return;
  const n = active.lines.length;
  active.idx = Math.max(0, Math.min(n - 1, idx | 0));
  paint();
  playSfx("hintReceived", { volume: 0.3 });
}

// Guest-side: hide the mirror. Host's close() fires after rewards have
// already been resolved authoritatively; the guest doesn't replay
// rewards (inventory is shared and addAmmo on guest would double-count).
export function closeNetworkDialogue() {
  if (!active || !active.isNetwork) return;
  active = null;
  if (root) root.style.display = "none";
}

function isDialogueObject(x) {
  return x && typeof x === "object" && !Array.isArray(x) && typeof x.text === "string";
}

function splitOnSeparator(s) {
  return String(s).split(/^---?$/m).map((x) => x.trim()).filter(Boolean);
}

function advance() {
  if (!active) return;
  active.idx++;
  if (active.idx >= active.lines.length) {
    close();
    return;
  }
  paint();
  playSfx("hintReceived", { volume: 0.3 });
  broadcastHostEvent("dialogueAdvance", { idx: active.idx });
}

function paint() {
  if (!active) return;
  root.querySelector("#dialogue-text").textContent = active.lines[active.idx];
}

function close() {
  if (!active) return;
  const resolve = active.resolve;
  const dialogue = active.dialogue;
  const playerIndex = active.playerIndex | 0;
  active = null;
  root.style.display = "none";
  broadcastHostEvent("dialogueClose");
  if (dialogue) handleReward(dialogue, playerIndex);
  if (typeof resolve === "function") resolve(dialogue);
}

// Mark the dialogue as read (gates downstream dialogues) and grant any
// one-time reward to the initiating player. Mirrors Rust
// dialogues.rs::handle_reward and storage.rs::set_dialogue_read — key
// prefix is `dialogue.answer.` so the data files' existing
// display_conditions resolve correctly. The reward-collected flag is
// global (one-shot per dialogue text), but the ammo lands in the
// initiating player's bucket.
function handleReward(d, playerIndex) {
  if (d.text) setValue(`dialogue.answer.${d.text}`, 1);
  if (!d.reward) return;
  const rewardKey = `dialogue.reward.${d.text}`;
  if (getValue(rewardKey) === 1) return;
  setValue(rewardKey, 1);
  addAmmo(d.reward, 1, playerIndex | 0);
  const sp = getSpecies(d.reward);
  const name = sp ? tr(sp.name) : String(d.reward);
  const template = tr("dialogue.reward_received");
  showToast(template.replace("%s", name), "longHint");
}

// Resolve the first dialogue from an entity that matches the current
// game state. Returns the Dialogue object (or null). Mirrors Rust
// entity.rs::next_dialogue.
export function resolveEntityDialogue(entity) {
  const dialogues = entity?.dialogues || [];
  for (const d of dialogues) {
    if (!d) continue;
    const key = d.key || "always";
    const ev = d.expected_value | 0;
    if (keyMatches(key, ev)) return d;
  }
  return null;
}

// Convenience: localize a dialogue's text into displayable lines. Used by
// the hint pickup path where we don't show the modal overlay but still
// want the resolved text.
export function dialogueLines(dialogue) {
  if (!dialogue) return [];
  return splitOnSeparator(dialogue.text).map((s) => tr(s));
}

// Test-only helpers.
export { keyMatches as _keyMatches };
