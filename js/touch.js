// On-screen touch controls for mobile: 4-way directional pad on the
// bottom-left and action buttons on the bottom-right (talk + throw).
// Synthesises the same keydown/keyup events that input.js already listens
// for, so no extra wiring is needed downstream.
//
// Hidden by default; show when a touch (or pointer with pointerType ===
// "touch") is detected so we don't clutter desktop screens.

import { tryShoot } from "./shooting.js?v=20260527";
import { tryMelee } from "./melee.js?v=20260527";
import { getEquipped, onEquipmentChange, SLOT_MELEE } from "./equipment.js?v=20260527";
import { getNetRole } from "./onlineBootstrap.js?v=20260527";
import { codesFor } from "./keyBindings.js?v=20260527";

const KEY_FOR_DIR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const heldBindings = new Map(); // dir -> pointerId

// pointerId -> direction button currently "pressed" by that finger. Used
// to implement drag-to-switch: as the finger moves over a different D-pad
// button, we release the old and press the new without requiring a lift.
const dirPointerHeld = new Map();

let root = null;
let visible = false;

export function installTouchControls() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "touch-controls";
  root.innerHTML = `
    <div class="touch-pad" data-side="left">
      <button class="touch-btn" data-dir="up">▲</button>
      <button class="touch-btn" data-dir="left">◀</button>
      <button class="touch-btn" data-dir="right">▶</button>
      <button class="touch-btn" data-dir="down">▼</button>
    </div>
    <div class="touch-pad" data-side="right">
      <button class="touch-btn touch-action touch-melee"    data-action="melee">⚔</button>
      <button class="touch-btn touch-action touch-throw"    data-action="throw">✦</button>
      <button class="touch-btn touch-action touch-interact" data-action="interact">E</button>
    </div>
    <div class="touch-pad" data-side="top-right">
      <button class="touch-btn touch-menu" data-action="menu">☰</button>
    </div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "12",
    display: "none",
    userSelect: "none",
    touchAction: "none",
  });
  document.body.appendChild(root);
  injectStyles();

  for (const btn of root.querySelectorAll(".touch-btn")) {
    btn.addEventListener("pointerdown", (e) => onPress(e, btn));
    btn.addEventListener("pointerup", (e) => onRelease(e, btn));
    btn.addEventListener("pointercancel", (e) => onRelease(e, btn));
    btn.addEventListener("pointerleave", (e) => {
      // Action buttons (no data-dir) auto-release on leave. Directional
      // buttons stay "held" until either pointerup or until the finger
      // moves over a *different* directional button — handled in the
      // document-level pointermove below.
      if (!btn.dataset.dir && btn.dataset.action) onRelease(e, btn);
    });
    // Prevent the browser's default context menu / long-press behaviour.
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Drag-to-switch on the D-pad: pointer events have implicit capture to
  // the original target, so we can't rely on pointerdown firing on a
  // *different* button when the finger slides. Instead we listen for
  // pointermove at the document level and use elementFromPoint to find
  // which button (if any) the finger is currently over.
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  // We released implicit capture on pointerdown for D-pad buttons, so
  // pointerup fires on whichever element is under the finger at release
  // — that may be off the pad entirely. Catch it at the document level
  // to make sure direction keys go up exactly once.
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);

  // Auto-reveal once we see touch input.
  window.addEventListener("pointerdown", (e) => {
    if (visible) return;
    if (e.pointerType === "touch") show();
  }, { capture: true });

  if (matchMedia("(pointer: coarse)").matches) show();

  syncMeleeVisibility();
  onEquipmentChange((slot) => { if (slot === SLOT_MELEE) syncMeleeVisibility(); });

  return root;
}

function syncMeleeVisibility() {
  if (!root) return;
  const btn = root.querySelector(".touch-melee");
  if (!btn) return;
  btn.style.display = getEquipped(SLOT_MELEE) ? "" : "none";
}

function show() {
  if (visible) return;
  visible = true;
  root.style.display = "block";
  document.body.classList.add("touch-mode");
}

function onPress(e, btn) {
  e.preventDefault();
  btn.classList.add("active");
  const dir = btn.dataset.dir;
  const action = btn.dataset.action;
  if (dir) {
    // Release implicit pointer capture so pointermove on the document
    // fires for the *element under the finger* rather than always for
    // the button we started on.
    try { btn.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    heldBindings.set(dir, e.pointerId);
    dirPointerHeld.set(e.pointerId, btn);
    dispatchKey("keydown", KEY_FOR_DIR[dir]);
  } else if (action === "interact") {
    dispatchKey("keydown", "KeyE");
  } else if (action === "menu") {
    dispatchKey("keydown", "Escape");
  } else if (action === "throw") {
    if (getNetRole() === "guest") {
      // Guests can't drive the local sim — synthesise a keydown so
      // guestInputForwarder turns it into a `shoot` intent on the wire.
      dispatchKey("keydown", codesFor("shoot")[0] || "KeyF");
    } else {
      // Don't synthesise a key event — shooting.js owns its own cooldown
      // and we want a single shot per tap, not a held-key auto-repeat.
      tryShoot();
    }
  } else if (action === "melee") {
    if (getNetRole() === "guest") {
      dispatchKey("keydown", codesFor("melee")[0] || "KeyG");
    } else {
      tryMelee();
    }
  }
}

function onRelease(e, btn) {
  e.preventDefault();
  // Direction releases follow the pointer, not the original element — the
  // finger may have moved off `btn` onto a sibling D-pad button.
  if (e.pointerId != null && dirPointerHeld.has(e.pointerId)) {
    releaseDirForPointer(e.pointerId);
    return;
  }
  btn.classList.remove("active");
  const action = btn.dataset.action;
  if (action === "interact") {
    dispatchKey("keyup", "KeyE");
  }
}

function onPointerUp(e) {
  if (dirPointerHeld.has(e.pointerId)) releaseDirForPointer(e.pointerId);
}

function onPointerMove(e) {
  const current = dirPointerHeld.get(e.pointerId);
  if (!current) return;
  // Decide direction by the dominant axis from the pad's centre rather
  // than requiring elementFromPoint to land on a button. The grid has
  // empty corner cells between adjacent directions, so a strict hit-test
  // releases the direction key while the finger crosses the corner —
  // feels like "I had to lift to switch." Quadrant logic keeps a
  // direction pressed continuously and switches at the diagonals.
  const next = directionButtonAt(e.clientX, e.clientY, current);
  if (next === current) return;
  releaseDirForPointer(e.pointerId);
  if (next) pressDir(next, e.pointerId);
  e.preventDefault();
}

// How far from the pad's centre we still treat the finger as "on the pad."
// The pad is a 3×3 grid of 52px cells (156px square); going much past the
// outer edge releases the held direction so dragging the finger entirely
// off the pad doesn't leave a stuck key.
const PAD_RELEASE_RADIUS_PX = 110;

function directionButtonAt(x, y, current) {
  if (!root) return null;
  const dirs = {};
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const b of root.querySelectorAll('.touch-btn[data-dir]')) {
    const r = b.getBoundingClientRect();
    dirs[b.dataset.dir] = b;
    sumX += r.left + r.width / 2;
    sumY += r.top + r.height / 2;
    count++;
  }
  if (!count) return null;
  const cx = sumX / count;
  const cy = sumY / count;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.hypot(dx, dy) > PAD_RELEASE_RADIUS_PX) return null;
  // Dominant axis wins. On exact ties (|dx| === |dy| — diagonal drag or
  // sitting at centre) keep the current direction to avoid flapping
  // between perpendicular keys.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay) return (dx >= 0 ? dirs.right : dirs.left) || null;
  if (ay > ax) return (dy >= 0 ? dirs.down  : dirs.up)   || null;
  return current;
}

function pressDir(btn, pointerId) {
  const dir = btn.dataset.dir;
  if (!dir) return;
  btn.classList.add("active");
  heldBindings.set(dir, pointerId);
  dirPointerHeld.set(pointerId, btn);
  dispatchKey("keydown", KEY_FOR_DIR[dir]);
}

function releaseDirForPointer(pointerId) {
  const btn = dirPointerHeld.get(pointerId);
  if (!btn) return;
  dirPointerHeld.delete(pointerId);
  btn.classList.remove("active");
  const dir = btn.dataset.dir;
  if (heldBindings.get(dir) === pointerId) {
    heldBindings.delete(dir);
    dispatchKey("keyup", KEY_FOR_DIR[dir]);
  }
}

function dispatchKey(type, code) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function injectStyles() {
  if (document.getElementById("touch-styles")) return;
  const style = document.createElement("style");
  style.id = "touch-styles";
  style.textContent = `
    #touch-controls .touch-pad {
      position: absolute;
      bottom: 5vh;
      pointer-events: none;
    }
    #touch-controls .touch-pad[data-side="left"] {
      left: 4vw;
      display: grid;
      grid-template-columns: repeat(3, 52px);
      grid-template-rows: repeat(3, 52px);
      gap: 0px;
    }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="up"]    { grid-column: 2; grid-row: 1; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="left"]  { grid-column: 1; grid-row: 2; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="right"] { grid-column: 3; grid-row: 2; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="down"]  { grid-column: 2; grid-row: 3; }
    #touch-controls .touch-pad[data-side="right"] {
      right: 4vw;
      bottom: 8vh;
      display: flex;
      flex-direction: column-reverse;
      gap: 14px;
      align-items: center;
    }
    #touch-controls .touch-pad[data-side="top-right"] {
      top: 12px;
      right: 12px;
      bottom: auto;
    }
    #touch-controls .touch-menu {
      width: 44px;
      height: 44px;
      font-size: 20px;
      background: rgba(40, 40, 40, 0.6);
    }
    #touch-controls .touch-btn {
      pointer-events: auto;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(40, 40, 40, 0.6);
      color: #eee;
      border: 1px solid rgba(180, 180, 180, 0.4);
      font-size: 18px;
      font-family: monospace;
      cursor: pointer;
      transition: background 80ms ease;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
    }
    #touch-controls .touch-action {
      width: 64px;
      height: 64px;
      font-size: 22px;
      background: rgba(60, 100, 60, 0.7);
    }
    #touch-controls .touch-throw {
      background: rgba(120, 70, 70, 0.75);
    }
    #touch-controls .touch-btn.active {
      background: rgba(120, 120, 120, 0.85);
    }
    @media (min-width: 980px) and (pointer: fine) {
      #touch-controls { display: none !important; }
    }
  `;
  document.head.appendChild(style);
}
