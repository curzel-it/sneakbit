// Guest-side: watches the keyboard and forwards movement intents to the
// host as `input` frames. Action intents (interact / shoot / melee) ride
// the same channel and land in Phase 7. Each frame carries a monotonic
// seq for the reconciliation logic that arrives in Phase 6.

import { actionForCode } from "./keyBindings.js";

const ACTION_TO_INTENT = {
  moveUp: "moveUp",
  moveDown: "moveDown",
  moveLeft: "moveLeft",
  moveRight: "moveRight",
  interact: "interact",
  shoot: "shoot",
  melee: "melee",
};

const MOVE_INTENTS = new Set(["moveUp", "moveDown", "moveLeft", "moveRight"]);

let net = null;
let seq = 0;
let installed = false;
const held = new Set();
let lastSentDir = null;

function intentToDir(intent) {
  switch (intent) {
    case "moveUp": return "up";
    case "moveDown": return "down";
    case "moveLeft": return "left";
    case "moveRight": return "right";
    default: return null;
  }
}

function dirToIntent(dir) {
  switch (dir) {
    case "up": return "moveUp";
    case "down": return "moveDown";
    case "left": return "moveLeft";
    case "right": return "moveRight";
    default: return null;
  }
}

export function installGuestInputForwarder(netIn) {
  if (installed) return;
  installed = true;
  net = netIn;
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) onBlur();
    });
  }
}

export function getSeq() { return seq; }

// Test seams.
export function _injectKeyDownForTesting(code) { onKeyDown({ code }); }
export function _injectKeyUpForTesting(code) { onKeyUp({ code }); }
export function _resetForwarderForTesting() {
  net = null;
  seq = 0;
  installed = false;
  held.clear();
  lastSentDir = null;
}

function onKeyDown(e) {
  if (e.repeat) return;
  const action = actionForCode(e.code);
  const intent = action && ACTION_TO_INTENT[action];
  if (!intent) return;
  const dir = intentToDir(intent);
  if (dir) {
    held.add(dir);
    if (dir !== lastSentDir) {
      lastSentDir = dir;
      send(intent);
    }
    return;
  }
  send(intent);
}

function onKeyUp(e) {
  const action = actionForCode(e.code);
  const intent = action && ACTION_TO_INTENT[action];
  if (!intent || !MOVE_INTENTS.has(intent)) return;
  const dir = intentToDir(intent);
  held.delete(dir);
  if (held.size === 0) {
    if (lastSentDir !== null) {
      lastSentDir = null;
      send("stopMove");
    }
    return;
  }
  const next = [...held][0];
  if (next !== lastSentDir) {
    lastSentDir = next;
    send(dirToIntent(next));
  }
}

function onBlur() {
  held.clear();
  if (lastSentDir !== null) {
    lastSentDir = null;
    send("stopMove");
  }
}

function send(intent) {
  if (!net?.isConnected?.()) return;
  seq++;
  net.send({ op: "input", seq, t: Date.now(), intent });
}
