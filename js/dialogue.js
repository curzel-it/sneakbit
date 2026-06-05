// Dialogue overlay. HTML element above the canvas with the current line.
// Advances on Space / Enter / Click. While open, the player is paused.
//
// Two payload shapes are supported:
//   - Legacy array of strings (already-resolved lines, no reward tracking)
//   - Rust-style Dialogue object: { text, key, expected_value, reward }.
//     On close, marks dialogue_read.<text>=1 and (if reward set + not yet
//     collected) adds the reward to inventory and shows a toast.

import { tr, trVariant } from "./strings.js";
import { getActiveInputDevice } from "./activeInputDevice.js";
import { playSfx } from "./audio.js";
import { getValue, setValue, keyMatches } from "./storage.js";
import { addAmmo } from "./inventory.js";
import { showToast } from "./toast.js";
import { getSpecies } from "./species.js";
import { matchesAction } from "./keyBindings.js";
import { registerMenuSurface } from "./menuNav.js";
import { broadcastHostEvent } from "./hostEvents.js";
import { parseRichText, richTextLength, richTextToHtml, formatBullets } from "./richText.js";
import { el } from "./dom.js";

let root = null;
let nameEl = null;
let textEl = null;
let active = null; // { lines, idx, resolve, dialogue, speaker, segs, revealed, ... }
let listener = null;
let typingRaf = 0;        // requestAnimationFrame handle for the typewriter
let lastRevealTs = 0;
let reduceMotion = false;

// Characters revealed per second by the typewriter.
const REVEAL_CPS = 55;

export function installDialogue() {
  if (root) return root;
  reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // The visible panel and the name "tab" are children so the name can sit
  // half-overlapping the panel's top edge.
  root = el("div", {
    id: "dialogue",
    html: `
    <div id="dialogue-name"></div>
    <div id="dialogue-panel">
      <div id="dialogue-text"></div>
      <div id="dialogue-caret">▾</div>
    </div>`,
  });
  document.body.appendChild(root);
  nameEl = root.querySelector("#dialogue-name");
  textEl = root.querySelector("#dialogue-text");

  const style = document.createElement("style");
  style.textContent = `
    #dialogue {
      position: fixed; left: 50%; bottom: 5%;
      transform: translateX(-50%) translateY(8px);
      width: min(720px, 90vw); min-width: min(400px, 80vw);
      display: none; opacity: 0; z-index: 15; cursor: pointer;
      transition: opacity .14s ease-out, transform .14s ease-out;
      -webkit-user-select: none; user-select: none;
    }
    #dialogue.is-open { opacity: 1; transform: translateX(-50%) translateY(0); }
    #dialogue-panel {
      position: relative;
      padding: 18px 20px 16px;
      color: #f2f2f2;
      font-family: monospace; font-size: 15px; line-height: 1.5;
      white-space: pre-wrap; overflow-wrap: break-word;
      background: linear-gradient(180deg, #20242e 0%, #14161c 100%);
      border: 1px solid #3a4150;
      border-top-color: #525d70;
      border-radius: var(--sb-card-radius);
      box-shadow: 0 10px 34px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.05);
    }
    #dialogue-text em { font-style: italic; color: #cfe0ff; }
    #dialogue-text strong { font-weight: 700; color: #ffe9a8; }
    #dialogue-name {
      display: none;
      position: relative; z-index: 1;
      margin: 0 0 -7px 14px; padding: 4px 12px 9px;
      width: fit-content; max-width: calc(100% - 28px);
      font-family: monospace; font-size: 13px; font-weight: 700;
      letter-spacing: .3px; color: #fff;
      background: linear-gradient(180deg, #3a4d8a 0%, #2b3a6b 100%);
      border: 1px solid #525d70; border-bottom: none;
      border-radius: var(--sb-card-radius) var(--sb-card-radius) 0 0;
      box-shadow: 0 -2px 10px rgba(0,0,0,.35);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #dialogue.has-name #dialogue-name { display: block; }
    #dialogue-caret {
      position: absolute; right: 12px; bottom: 8px;
      color: #8fa3c8; font-size: 13px; opacity: 0;
      transition: opacity .1s linear;
      animation: dialogue-caret-bob .9s ease-in-out infinite;
    }
    #dialogue.is-ready #dialogue-caret { opacity: 1; }
    @keyframes dialogue-caret-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(3px); }
    }
    @media (prefers-reduced-motion: reduce) {
      #dialogue { transition: none; }
      #dialogue-caret { animation: none; }
    }
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
      // Stop later window keydown listeners (notably interact.js) from
      // acting on this same press. Without this, closing the dialogue with
      // the interact key would null out `active` and then let interact.js
      // immediately re-open it on the very same event.
      e.stopImmediatePropagation();
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

export function showDialogue(payload, playerIndex = 0, speaker = "") {
  return new Promise((resolve) => {
    const dialogue = isDialogueObject(payload) ? payload : null;
    const rawLines = dialogue ? [dialogue.text] : (Array.isArray(payload) ? payload : [payload]);
    const touch = getActiveInputDevice() === "touch";
    const lines = rawLines.flatMap(splitOnSeparator).map((s) => trVariant(s, touch)).filter((s) => s !== "");
    // A hint blanked for this platform (or an otherwise-empty payload) has
    // nothing to show. Still settle the promise and grant any reward so
    // progression/read-tracking isn't skipped, but don't open an empty panel.
    if (lines.length === 0) {
      if (dialogue) handleReward(dialogue, playerIndex | 0);
      resolve(dialogue);
      return;
    }
    active = { lines, idx: 0, resolve, dialogue, playerIndex: playerIndex | 0, speaker: speaker || "" };
    openPanel();
    paint();
    playSfx("hintReceived", { volume: 0.5 });
    // Mirror to guests with the already-localized lines + speaker so they
    // don't need their own dialogue/reward resolution. Idx starts at 0 to
    // match the host's freshly-painted state.
    broadcastHostEvent("dialogueOpen", { lines, idx: 0, speaker: active.speaker });
  });
}

// Resolve the speaker label for an entity, or "" if it shouldn't show one.
// Only true characters (species named under `npc.name.*`) get a name tab;
// hints, signs and other objects (`objects.name.*`) stay anonymous so we
// don't surface internal labels like "Hint (One Time)".
export function speakerNameForEntity(entity) {
  const sp = getSpecies(entity?.species_id);
  if (!sp || typeof sp.name !== "string" || !sp.name.startsWith("npc.name.")) return "";
  const name = tr(sp.name);
  return name && name !== sp.name ? name : "";
}

// Guest-side entry point. Driven by event:dialogueOpen from the host.
// Reuses the same DOM but flags `isNetwork:true` so local keys/clicks
// can't advance it — only event:dialogueAdvance/Close from the host
// move the state forward.
export function showNetworkDialogue(lines, speaker = "") {
  if (!root) return;
  if (!Array.isArray(lines) || lines.length === 0) return;
  active = {
    lines: lines.slice(),
    idx: 0,
    resolve: null,
    dialogue: null,
    playerIndex: 0,
    speaker: speaker || "",
    isNetwork: true,
  };
  openPanel();
  paint();
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
  hidePanel();
}

function isDialogueObject(x) {
  return x && typeof x === "object" && !Array.isArray(x) && typeof x.text === "string";
}

function splitOnSeparator(s) {
  return String(s).split(/^---?$/m).map((x) => x.trim()).filter(Boolean);
}

function advance() {
  if (!active) return;
  // First press while the line is still revealing snaps it to full instead
  // of skipping ahead — the familiar JRPG "show it all now" beat.
  if (!active.revealed) {
    finishReveal();
    return;
  }
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
  const speaker = active.speaker || "";
  nameEl.textContent = speaker;
  root.classList.toggle("has-name", !!speaker);

  active.segs = parseRichText(formatBullets(active.lines[active.idx] ?? ""));
  active.total = richTextLength(active.segs);
  active.shown = 0;
  active.revealed = false;
  root.classList.remove("is-ready");
  renderReveal();

  // No motion (preference or empty line) → show it all immediately.
  if (reduceMotion || active.total === 0) finishReveal();
  else startTypewriter();
}

function renderReveal() {
  if (!active) return;
  textEl.innerHTML = richTextToHtml(active.segs, active.shown);
}

function startTypewriter() {
  stopTypewriter();
  lastRevealTs = 0;
  const step = (ts) => {
    if (!active) return;
    if (!lastRevealTs) lastRevealTs = ts;
    const add = Math.floor(((ts - lastRevealTs) / 1000) * REVEAL_CPS);
    if (add > 0) {
      active.shown = Math.min(active.total, active.shown + add);
      lastRevealTs = ts;
      renderReveal();
    }
    if (active.shown >= active.total) { finishReveal(); return; }
    typingRaf = requestAnimationFrame(step);
  };
  typingRaf = requestAnimationFrame(step);
}

function finishReveal() {
  stopTypewriter();
  if (!active) return;
  active.shown = active.total;
  active.revealed = true;
  renderReveal();
  root.classList.add("is-ready"); // shows the bobbing continue caret
}

function stopTypewriter() {
  if (typingRaf) { cancelAnimationFrame(typingRaf); typingRaf = 0; }
}

function openPanel() {
  stopTypewriter();
  root.style.display = "block";
  void root.offsetWidth; // reflow so the open transition runs from hidden
  root.classList.add("is-open");
}

function hidePanel() {
  stopTypewriter();
  root.classList.remove("is-open", "is-ready", "has-name");
  root.style.display = "none";
}

function close() {
  if (!active) return;
  const resolve = active.resolve;
  const dialogue = active.dialogue;
  const playerIndex = active.playerIndex | 0;
  active = null;
  hidePanel();
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
export function handleReward(d, playerIndex) {
  if (d.text) setValue(`dialogue.answer.${d.text}`, 1);
  if (!d.reward) return;
  const rewardKey = `dialogue.reward.${d.text}`;
  if (getValue(rewardKey) === 1) return;
  setValue(rewardKey, 1);
  grantReward(d.reward, playerIndex | 0);
  const sp = getSpecies(d.reward);
  const name = sp ? tr(sp.name) : String(d.reward);
  const template = tr("dialogue.reward_received");
  showToast(template.replace("%s", name), "longHint");
}

// Drop a reward species into the player's inventory, expanding bundles into
// their contents — a "kunai.x10" bundle (7001) grants 10 kunai (7000), not a
// single un-usable bundle entry. Mirrors Rust storage.rs::increment_inventory_count,
// which recurses through bundle_contents, and matches the floor-pickup path in
// pickups.js.
function grantReward(speciesId, playerIndex) {
  const sp = getSpecies(speciesId);
  if (sp?.bundle_contents?.length) {
    const counts = new Map();
    for (const cid of sp.bundle_contents) counts.set(cid, (counts.get(cid) || 0) + 1);
    for (const [cid, n] of counts) addAmmo(cid, n, playerIndex);
  } else {
    addAmmo(speciesId, 1, playerIndex);
  }
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
  const touch = getActiveInputDevice() === "touch";
  return splitOnSeparator(dialogue.text).map((s) => trVariant(s, touch)).filter((s) => s !== "");
}

// Test-only helpers.
export { keyMatches as _keyMatches };
