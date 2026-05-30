// Browser Gamepad API integration.
//
// Each tick the input layer asks `pollGamepadForSlot(slot)` for that
// slot's fresh press events + held set, and feeds them into the same
// channel keyboard.js uses. Action buttons (A = interact, X = melee,
// B = shoot, Start = menu) fire one-shot callbacks registered per slot
// via `setGamepadAction(name, fn, slot)`.
//
// Pads are mapped to slots by connection order: the lowest-index
// connected pad drives slot 1 (player 1 / host), the next drives slot 2
// (local co-op P2). Online guests poll their own machine's pad on their
// own client, so only slots 1–2 are ever assigned here.
//
// Stick layout: left stick OR d-pad. Either source counts as held; a
// transition from neutral → direction emits a press event. The left
// stick maps to a single cardinal direction by 90° sector (whichever
// axis is dominant), so it reads as a clean 4-way pad with no ambiguous
// diagonals — the right fit for tile-locked movement. A small rest gate
// (STICK_DEADZONE) only decides "is the stick being pushed at all" so a
// thumb resting on a noisy stick doesn't drift the hero.
//
// Action buttons (interact / shoot / melee) and the menu button are
// rebindable per player — gamepadBindings.js owns the action→button map
// and its Standard-Mapping defaults (A / B / X / Start). The menu button
// is global: any pad's bound menu button toggles the overlay, mirroring
// keyBindings treating Esc as global. D-pad + stick stay fixed cardinal.
// D-pad: 12 up / 13 down / 14 left / 15 right.

import { buttonFor, menuButton } from "./gamepadBindings.js?v=20260530e";
import { markInputDevice } from "./activeInputDevice.js?v=20260530e";
import * as menuNav from "./menuNav.js?v=20260530e";
import { isMenuNavActive } from "./menuNav.js?v=20260530e";

const ACTION_NAMES = ["interact", "shoot", "melee"];

// Minimum stick deflection before it registers at all — just enough to
// reject rest-state jitter/drift, not a per-direction activation
// threshold. Past it, the 90° sector (dominant axis) decides direction.
const STICK_DEADZONE = 0.25;

const DIR_BUTTONS = { 12: "up", 13: "down", 14: "left", 15: "right" };

// While true (the menu's controller-rebind capture is open) scanPad still
// tracks button edges but fires no action/menu callbacks — so binding a
// button doesn't also shoot or pop the menu.
let capturing = false;

export function setGamepadCapturing(v) { capturing = !!v; }

// Per-slot action callbacks. Slot 1 keeps the historical single-player /
// host wiring; slot 2 is wired for local co-op P2 in main.js.
const actionCallbacks = {};

// Per-pad edge state keyed by pad.index, so press events and button
// rising edges are computed independently for each physical pad.
const padState = new Map();

export function setGamepadAction(name, fn, slot = 1) {
  const slotCbs = actionCallbacks[slot] || (actionCallbacks[slot] = {});
  if (["interact", "shoot", "melee"].includes(name)) slotCbs[name] = fn;
}

// Connected pads sorted by their hardware index, holes removed. The
// position in this list is the slot assignment (0 → slot 1, 1 → slot 2).
function connectedPadsByIndex() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  const pads = navigator.getGamepads();
  if (!pads) return [];
  return [...pads].filter(Boolean).sort((a, b) => a.index - b.index);
}

// Hardware pad.index currently driving `slot`, or -1 if no pad is
// assigned. Used by rumble.js to vibrate the right physical controller.
export function getPadIndexForSlot(slot) {
  const pad = connectedPadsByIndex()[slot - 1];
  return pad ? pad.index : -1;
}

// Reverse of getPadIndexForSlot: which 1-based slot a hardware pad.index
// currently drives (by connection order), or -1 if it isn't connected.
// Used by controllerPresence to name the player on connect/disconnect.
export function slotForPadIndex(padIndex) {
  const pos = connectedPadsByIndex().findIndex((p) => p.index === padIndex);
  return pos < 0 ? -1 : pos + 1;
}

// Returns { events, held } for the pad assigned to `slot`, draining its
// press edges and firing that slot's action callbacks. Empty when no pad
// is assigned to the slot.
export function pollGamepadForSlot(slot) {
  const pad = connectedPadsByIndex()[slot - 1];
  if (!pad) return { events: [], held: new Set() };
  return scanPad(pad, slot);
}

// Back-compat alias — slot 1 only. Kept so callers that just want the
// single-player pad don't need to know about slots.
export function pollGamepadDirections() {
  return pollGamepadForSlot(1);
}

// Side-effect-free set of button indices currently pressed on the pad
// assigned to `slot`. The menu's rebind capture polls this to detect the
// next button press without going through scanPad's callbacks.
export function pressedButtonsForSlot(slot) {
  const pad = connectedPadsByIndex()[slot - 1];
  const out = new Set();
  if (!pad) return out;
  for (let i = 0; i < pad.buttons.length; i++) {
    if (pad.buttons[i]?.pressed) out.add(i);
  }
  return out;
}

// Side-effect-free read of the pad assigned to `slot`: its held
// directions + action-button pressed state, with no edge tracking and no
// callbacks fired. The guest forwarder uses this to do its own edge
// detection and forward intents to the host, instead of acting locally.
export function readPadSnapshotForSlot(slot) {
  const pad = connectedPadsByIndex()[slot - 1];
  if (!pad) return null;
  const playerIndex = slot - 1;
  const pressed = (action) => {
    const idx = buttonFor(action, playerIndex);
    return idx >= 0 && !!pad.buttons[idx]?.pressed;
  };
  return {
    held: buildHeld(pad),
    interact: pressed("interact"),
    shoot:    pressed("shoot"),
    melee:    pressed("melee"),
  };
}

function buildHeld(pad) {
  const held = new Set();
  // Left stick → one cardinal direction by 90° sector. Once past the rest
  // gate, the larger-magnitude axis wins (ties at the 45° diagonal go
  // horizontal), so the stick never registers two directions at once.
  const [ax, ay] = readAxes(pad);
  if (Math.hypot(ax, ay) >= STICK_DEADZONE) {
    if (Math.abs(ax) >= Math.abs(ay)) held.add(ax < 0 ? "left" : "right");
    else held.add(ay < 0 ? "up" : "down");
  }
  // D-pad — discrete buttons, added as-is (a deliberate two-button
  // diagonal still resolves downstream via HOLD_PRIORITY).
  for (const [idx, dir] of Object.entries(DIR_BUTTONS)) {
    if (pad.buttons[idx]?.pressed) held.add(dir);
  }
  return held;
}

function scanPad(pad, slot) {
  let st = padState.get(pad.index);
  if (!st) { st = { prevHeld: new Set(), prevButtons: new Map() }; padState.set(pad.index, st); }

  const held = buildHeld(pad);

  // Press events: directions newly held since last scan of this pad.
  const events = [];
  for (const dir of held) {
    if (!st.prevHeld.has(dir)) events.push(dir);
  }

  const playerIndex = slot - 1;
  if (!capturing && isMenuNavActive()) {
    // Menu mode: the pad drives roving navigation instead of gameplay.
    // Uses the FIXED convention (A = confirm, B / Start = back) regardless
    // of the rebindable gameplay bindings.
    for (const dir of events) {
      if (dir === "up") menuNav.move(-1);
      else if (dir === "down") menuNav.move(1);
      else if (dir === "left") menuNav.moveHorizontal(-1);
      else if (dir === "right") menuNav.moveHorizontal(1);
    }
    fireEdge(st, pad, 0, () => menuNav.confirm());
    fireEdge(st, pad, 1, () => menuNav.back());
    fireEdge(st, pad, START_BUTTON, () => menuNav.back());
  } else {
    // Gameplay: action buttons resolve via this player's bindings and fire
    // the slot's callback on the rising edge.
    for (const name of ACTION_NAMES) {
      const idx = buttonFor(name, playerIndex);
      if (idx < 0) continue;
      fireEdge(st, pad, idx, () => {
        if (capturing) return;
        const cb = actionCallbacks[slot]?.[name];
        if (cb) {
          try { cb(); } catch (e) { console.error(`gamepad ${name} cb:`, e); }
        }
      });
    }
    // The (global, P1-owned) menu button dispatches a synthetic Esc keydown
    // so menu.js's existing listener wires through without a parallel API.
    const mbtn = menuButton();
    if (mbtn >= 0) {
      fireEdge(st, pad, mbtn, () => {
        if (capturing) return;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
        }
      });
    }
  }

  st.prevHeld = held;
  // Any real pad input this frame makes the gamepad the active device, so
  // prompts switch to controller glyphs (idle pads with centered sticks
  // and no buttons don't hijack a keyboard player).
  if (held.size > 0 || pad.buttons.some((b) => b?.pressed)) markInputDevice("gamepad");
  return { events, held: new Set(held) };
}

function readAxes(pad) {
  return [
    typeof pad.axes[0] === "number" ? pad.axes[0] : 0,
    typeof pad.axes[1] === "number" ? pad.axes[1] : 0,
  ];
}

function fireEdge(st, pad, idx, onRise) {
  const pressedNow = !!pad.buttons[idx]?.pressed;
  const pressedLast = !!st.prevButtons.get(idx);
  st.prevButtons.set(idx, pressedNow);
  if (pressedNow && !pressedLast) onRise();
}

// Test seam — clears per-pad edge state so a fresh test starts with no
// stale "previously held" memory between cases.
export function _resetGamepadForTesting() {
  padState.clear();
  for (const k of Object.keys(actionCallbacks)) delete actionCallbacks[k];
}
