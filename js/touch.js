// On-screen touch controls for mobile: 4-way directional pad on the
// bottom-left and action buttons on the bottom-right (talk + throw).
// Synthesises the same keydown/keyup events that input.js already listens
// for, so no extra wiring is needed downstream.
//
// Hidden by default; show when a touch (or pointer with pointerType ===
// "touch") is detected so we don't clutter desktop screens.

import { tryShoot } from "./shooting.js";
import { tryMelee } from "./melee.js";
import { getEquipped, onEquipmentChange, SLOT_MELEE } from "./equipment.js";
import { getNetRole } from "./onlineBootstrap.js";
import { codesFor } from "./keyBindings.js";
import { isTowerDefenseMode } from "./gameMode.js";
import { onActiveInputDeviceChange } from "./activeInputDevice.js";
import { getSettings } from "./settings.js";
import { mountJoystick, unmountJoystick } from "./touchJoystick.js";
import { el } from "./dom.js";

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

// Tower-Defense build verbs. During the build phase the action cluster stops
// being "attack" and becomes a tiny build toolbar, so the icons swap to match
// what the button now does — a barrel (open shop), a drop-into-grid (place), a
// trash can (remove) and a check (done). Paired with a text label so the verb
// is unambiguous (a sword that "removes" reads wrong; a labelled trash can
// doesn't).
const ICON_TD_SHOP   = svg(`<ellipse cx="12" cy="6" rx="6" ry="2.4"></ellipse><path d="M6 6v12c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4V6"></path><path d="M6 12c0 1.3 2.7 2.4 6 2.4s6-1.1 6-2.4"></path>`, 24);
const ICON_TD_PLACE  = svg(`<rect x="4" y="4" width="16" height="16" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line>`, 24);
const ICON_TD_REMOVE = svg(`<polyline points="4 7 20 7"></polyline><path d="M6 7l1 13h10l1-13"></path><path d="M9 7V4h6v3"></path>`, 22);
const ICON_TD_DONE   = svg(`<polyline points="5 13 10 18 19 6"></polyline>`, 24);
const heldBindings = new Map(); // dir -> pointerId

// pointerId -> direction button currently "pressed" by that finger. Used
// to implement drag-to-switch: as the finger moves over a different D-pad
// button, we release the old and press the new without requiring a lift.
const dirPointerHeld = new Map();

let root = null;
let visible = false;
// "buttons" = 4-way d-pad, "joystick" = floating analog stick. Read from
// settings at install; changeable live from the settings panel.
let controlStyle = "buttons";
// Desktop dev flag: `?touch=1` forces the overlay visible on a fine
// pointer so the joystick can be tuned with a mouse (and so the e2e /
// remote-verify harness can drive it). Off in normal play.
let forcedTouch = false;

export function installTouchControls() {
  if (root) return root;
  // SVG icons (not text glyphs): the previous "▲ ◀ ▶ ▼ ⚔ ✦ E ☰"
  // glyphs let iOS Safari pop the "magnifier loupe" on long-press
  // even with -webkit-user-select: none + -webkit-touch-callout: none
  // — those CSS rules suppress selection and the callout but not the
  // loupe over text. SVG paths aren't text, so the loupe never fires.
  // The SVGs themselves are wrapped in <span class="touch-icon"> with
  // pointer-events: none so taps still hit the parent <button> and
  // dispatch the keydown.
  root = el("div", {
    id: "touch-controls",
    html: `
    <div class="touch-pad" data-side="left">
      <button class="touch-btn" data-dir="up">${ICON_DIR_UP}</button>
      <button class="touch-btn" data-dir="left">${ICON_DIR_LEFT}</button>
      <button class="touch-btn" data-dir="right">${ICON_DIR_RIGHT}</button>
      <button class="touch-btn" data-dir="down">${ICON_DIR_DOWN}</button>
    </div>
    <div class="touch-pad" data-side="right">
      <button class="touch-btn touch-action touch-melee"    data-action="melee">${ICON_MELEE}<span class="touch-label"></span></button>
      <button class="touch-btn touch-action touch-throw"    data-action="throw">${ICON_THROW}<span class="touch-label"></span></button>
      <button class="touch-btn touch-action touch-interact" data-action="interact">${ICON_INTERACT}<span class="touch-label"></span></button>
    </div>
    <div class="touch-pad" data-side="top-right">
      <button class="touch-btn touch-menu" data-action="menu">${ICON_MENU}</button>
    </div>
  `,
    style: {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "12",
      display: "none",
      userSelect: "none",
      touchAction: "none",
    },
  });
  controlStyle = getSettings().touchControls === "joystick" ? "joystick" : "buttons";
  try { forcedTouch = new URLSearchParams(location.search).has("touch"); } catch { /* ignore */ }
  if (forcedTouch) root.classList.add("force-touch");
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

  if (forcedTouch || matchMedia("(pointer: coarse)").matches) show();

  // Fold into the active-device model: the on-screen pad belongs to touch,
  // so hide it the moment a key or controller is used and bring it back on
  // touch. Keeps a desktop player who taps once from being stuck with the
  // overlay, and vice-versa.
  onActiveInputDeviceChange((d) => {
    // While forced on for desktop testing, ignore device changes so a
    // stray mouse/keyboard event doesn't yank the overlay away.
    if (forcedTouch) return;
    if (d === "touch") show(); else hide();
  });

  syncMeleeVisibility();
  onEquipmentChange((slot) => { if (slot === SLOT_MELEE) syncMeleeVisibility(); });

  applyControlStyle();
  return root;
}

// Show the d-pad or the floating joystick for movement, depending on the
// current style. The action buttons + menu are shared and untouched.
function applyControlStyle() {
  if (!root) return;
  const leftPad = root.querySelector('.touch-pad[data-side="left"]');
  if (controlStyle === "joystick") {
    if (leftPad) leftPad.style.display = "none";
    mountJoystick(root);
  } else {
    unmountJoystick();
    if (leftPad) leftPad.style.display = "";
  }
}

// Switch movement input live from the settings panel.
export function setTouchControlStyle(style) {
  controlStyle = style === "joystick" ? "joystick" : "buttons";
  applyControlStyle();
}

function syncMeleeVisibility() {
  if (!root) return;
  const btn = root.querySelector(".touch-melee");
  if (!btn) return;
  // In Tower Defense the melee button is the build "remove" control (it
  // refunds the barrel the active hero faces), so it must show regardless of
  // whether a melee weapon is equipped.
  btn.style.display = (isTowerDefenseMode() || getEquipped(SLOT_MELEE)) ? "" : "none";
}

// Re-evaluate which action buttons show — towerDefense calls this when a run
// starts so the melee/remove button appears even if the squad carries no
// melee weapon (and the mode flips after the overlay was first built).
export function refreshTouchActions() {
  if (tdActionMode) applyTdActionMode(); else syncMeleeVisibility();
}

// — Tower-Defense action cluster ——————————————————————————————————————————
// In TD the three right-side buttons change job by phase, and their icons +
// labels follow so a thumb knows what each does without reading a hint:
//   browse → only "Shop" (open the build dialog)
//   shop   → none (the modal owns its own buttons)
//   place  → "Place" / "Remove" / "Done"
//   wave   → attack cluster (shoot + melee), no labels
//   null   → back to the normal game cluster
// Driven each frame by tdHud.updateTdHud, cached so the DOM only churns on a
// real change.
let tdActionMode = null;

export function setTdActionMode(mode) {
  const next = mode || null;
  if (next === tdActionMode) return;
  tdActionMode = next;
  applyTdActionMode();
}

function applyTdActionMode() {
  if (!root) return;
  const interact = root.querySelector(".touch-interact");
  const melee = root.querySelector(".touch-melee");
  const throwBtn = root.querySelector(".touch-throw");
  if (!interact || !melee || !throwBtn) return;

  if (tdActionMode === "place") {
    setActionButton(interact, ICON_TD_PLACE, "Place", "");
    setActionButton(melee, ICON_TD_REMOVE, "Remove", "");
    setActionButton(throwBtn, ICON_TD_DONE, "Done", "");
  } else if (tdActionMode === "browse") {
    setActionButton(interact, ICON_TD_SHOP, "Shop", "");
    setActionButton(melee, ICON_MELEE, "", "none");
    setActionButton(throwBtn, ICON_THROW, "", "none");
  } else if (tdActionMode === "shop") {
    // The shop modal carries its own Start placing / Close buttons.
    setActionButton(interact, ICON_TD_SHOP, "", "none");
    setActionButton(melee, ICON_MELEE, "", "none");
    setActionButton(throwBtn, ICON_THROW, "", "none");
  } else if (tdActionMode === "wave") {
    setActionButton(interact, ICON_INTERACT, "", "none"); // nothing to interact with mid-wave
    setActionButton(throwBtn, ICON_THROW, "", "");
    setActionButton(melee, ICON_MELEE, "", "");
  } else {
    // Not TD — restore the normal game cluster.
    setActionButton(interact, ICON_INTERACT, "", "");
    setActionButton(throwBtn, ICON_THROW, "", "");
    setActionButton(melee, ICON_MELEE, "", "");
    syncMeleeVisibility();
  }
}

function setActionButton(btn, iconHtml, label, display) {
  const icon = btn.querySelector(".touch-icon");
  if (icon) icon.outerHTML = iconHtml; // constants include the .touch-icon wrapper
  const lbl = btn.querySelector(".touch-label");
  if (lbl) lbl.textContent = label;
  btn.style.display = display;
}

function show() {
  if (visible) return;
  visible = true;
  root.style.display = "block";
  document.body.classList.add("touch-mode");
  // The action set can depend on the live game mode (TD relabels the cluster
  // by phase) — re-evaluate each time the overlay appears, respecting any
  // active TD mode rather than just the melee-visibility default.
  refreshTouchActions();
}

function hide() {
  if (!visible) return;
  visible = false;
  root.style.display = "none";
  document.body.classList.remove("touch-mode");
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
    if (isTowerDefenseMode()) {
      // TD build: the throw button is the "back/done" verb (close shop / exit
      // placement); in a wave it shoots the active hero. Route through onKey.
      dispatchKey("keydown", codesFor("shoot")[0] || "KeyF");
    } else if (getNetRole() === "guest") {
      // Guests can't drive the local sim — synthesise a keydown so
      // guestInputForwarder turns it into a `shoot` intent on the wire.
      dispatchKey("keydown", codesFor("shoot")[0] || "KeyF");
    } else {
      // Don't synthesise a key event — shooting.js owns its own cooldown
      // and we want a single shot per tap, not a held-key auto-repeat.
      tryShoot();
    }
  } else if (action === "melee") {
    if (isTowerDefenseMode()) {
      // TD build phase: Melee removes the barrel in front of the active hero.
      // Synthesise the key so towerDefense.onKey routes it to the active hero
      // (interact already does this for placing via the KeyE branch above).
      dispatchKey("keydown", codesFor("melee")[0] || "KeyG");
    } else if (getNetRole() === "guest") {
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
      border-radius: var(--sb-surface-radius);
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
    /* Verb label for the TD build cluster. Sits to the LEFT of the round
       button (toward screen centre) so it never collides with the stacked
       buttons above/below, and reads as a little pill. Empty = hidden. */
    #touch-controls .touch-action { position: relative; }
    #touch-controls .touch-label {
      position: absolute; right: 100%; top: 50%; transform: translate(-8px, -50%);
      pointer-events: none; white-space: nowrap;
      font-family: var(--sb-font, monospace); font-size: 12px; font-weight: bold;
      color: var(--sb-text); background: var(--sb-surface-bg);
      border: var(--sb-surface-border); border-radius: var(--sb-surface-radius); padding: 3px 7px;
      text-shadow: 0 1px 0 #000;
    }
    #touch-controls .touch-label:empty { display: none; }
    @media (min-width: 980px) and (pointer: fine) {
      #touch-controls { display: none !important; }
      /* The ?touch=1 flag keeps the overlay up on desktop for tuning
         the joystick with a mouse. Higher specificity (id+class) plus
         !important beats the hide rule above. */
      #touch-controls.force-touch { display: block !important; }
    }
  `;
  document.head.appendChild(style);
}
