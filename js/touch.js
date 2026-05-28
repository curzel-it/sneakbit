// On-screen touch controls for mobile: 4-way directional pad on the
// bottom-left and action buttons on the bottom-right (talk + throw).
// Synthesises the same keydown/keyup events that input.js already listens
// for, so no extra wiring is needed downstream.
//
// Hidden by default; show when a touch (or pointer with pointerType ===
// "touch") is detected so we don't clutter desktop screens.

import { tryShoot } from "./shooting.js?v=20260528h";
import { tryMelee } from "./melee.js?v=20260528h";
import { getEquipped, onEquipmentChange, SLOT_MELEE } from "./equipment.js?v=20260528h";
import { getNetRole } from "./onlineBootstrap.js?v=20260528h";
import { codesFor } from "./keyBindings.js?v=20260528h";

const KEY_FOR_DIR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

// Touch button icons. Inline SVG so there's no extra HTTP request and
// no font dependency. `aria-hidden` keeps them out of the AT tree (the
// button itself takes the label via data-action). `focusable="false"`
// prevents IE/Edge legacy tabbing into the icon. Tile size is 22×22
// inside a 56×56 button — leaves a clear margin around the pad so the
// outer border reads even on small phones. Everything strokes from
// currentColor so the icon picks up the button's color rule.
function svg(content, size = 22) {
  return `<span class="touch-icon"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${content}</svg></span>`;
}

// Direction arrows — chevron-style so the angle reads as "direction
// you'll move" rather than a generic up/down play-button.
const ICON_DIR_UP    = svg(`<polyline points="6,15 12,9 18,15"></polyline>`);
const ICON_DIR_DOWN  = svg(`<polyline points="6,9 12,15 18,9"></polyline>`);
const ICON_DIR_LEFT  = svg(`<polyline points="15,6 9,12 15,18"></polyline>`);
const ICON_DIR_RIGHT = svg(`<polyline points="9,6 15,12 9,18"></polyline>`);

// Action icons. Kept iconographic, not photorealistic — fewer points
// = crisper at small sizes.
//   Interact: speech-bubble + dot, signals "talk / use".
//   Throw:    star-spark for kunai. Generic enough to still read if a
//             different ranged weapon ever takes the slot.
//   Melee:    a sword outline. Sized larger so the cross-guard reads.
//   Menu:     three horizontal lines (hamburger), the platform norm.
const ICON_INTERACT = svg(`<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"></path><circle cx="12" cy="12" r="0.6" fill="currentColor"></circle>`, 24);
const ICON_THROW    = svg(`<path d="M12 3 L13.4 9.4 L20 11 L13.4 12.6 L12 19 L10.6 12.6 L4 11 L10.6 9.4 Z" fill="currentColor" stroke="none"></path>`, 24);
const ICON_MELEE    = svg(`<path d="M14 4 L20 4 L20 10 L9.5 20.5 L7 21 L3 17 L3.5 14.5 L14 4 Z"></path><line x1="9" y1="9" x2="15" y2="15"></line>`, 24);
const ICON_MENU     = svg(`<line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line>`, 22);
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
  // SVG icons (not text glyphs): the previous "▲ ◀ ▶ ▼ ⚔ ✦ E ☰"
  // glyphs let iOS Safari pop the "magnifier loupe" on long-press
  // even with -webkit-user-select: none + -webkit-touch-callout: none
  // — those CSS rules suppress selection and the callout but not the
  // loupe over text. SVG paths aren't text, so the loupe never fires.
  // The SVGs themselves are wrapped in <span class="touch-icon"> with
  // pointer-events: none so taps still hit the parent <button> and
  // dispatch the keydown.
  root.innerHTML = `
    <div class="touch-pad" data-side="left">
      <button class="touch-btn" data-dir="up">${ICON_DIR_UP}</button>
      <button class="touch-btn" data-dir="left">${ICON_DIR_LEFT}</button>
      <button class="touch-btn" data-dir="right">${ICON_DIR_RIGHT}</button>
      <button class="touch-btn" data-dir="down">${ICON_DIR_DOWN}</button>
    </div>
    <div class="touch-pad" data-side="right">
      <button class="touch-btn touch-action touch-melee"    data-action="melee">${ICON_MELEE}</button>
      <button class="touch-btn touch-action touch-throw"    data-action="throw">${ICON_THROW}</button>
      <button class="touch-btn touch-action touch-interact" data-action="interact">${ICON_INTERACT}</button>
    </div>
    <div class="touch-pad" data-side="top-right">
      <button class="touch-btn touch-menu" data-action="menu">${ICON_MENU}</button>
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
    }
    #touch-controls .touch-btn {
      pointer-events: auto;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--sb-surface-bg);
      color: var(--sb-text);
      border: var(--sb-surface-border);
      cursor: pointer;
      transition: background 80ms ease;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    /* Action buttons share the neutral HUD surface but pick up a
       colored border tint so players can still read the verb at a
       glance (red = attack, green = positive/contact). The icon does
       most of the heavy identification — the tint is the "accent" of
       the design system, not a primary fill. */
    #touch-controls .touch-action {
      width: 64px;
      height: 64px;
      border-color: var(--sb-accent-positive);
    }
    #touch-controls .touch-throw {
      border-color: var(--sb-accent-attack);
    }
    #touch-controls .touch-btn.active {
      background: var(--sb-surface-bg-active);
    }
    /* Icon wrapper. pointer-events: none so taps that land on the SVG
       still bubble to the button — without this the wrapper would
       eat the pointerdown and onPress wouldn't fire on direct hits. */
    #touch-controls .touch-icon {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%;
      pointer-events: none;
    }
    @media (min-width: 980px) and (pointer: fine) {
      #touch-controls { display: none !important; }
    }
  `;
  document.head.appendChild(style);
}
