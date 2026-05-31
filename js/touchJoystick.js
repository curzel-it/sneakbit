// Floating on-screen joystick for touch movement — an alternative to the
// 4-button d-pad in touch.js. Ported from the original Rust game's iOS /
// Android JoystickView: the stick appears wherever the thumb first lands in
// the left zone, follows the finger when it drags past the edge (auto-pan),
// and maps the thumb angle to one of four cardinal directions. Like the
// d-pad it synthesises the same Arrow keydown/keyup events input.js already
// listens for, so nothing downstream knows the input came from a joystick.
//
// Importable in Node (the geometry helper is pure and DOM-free at module
// load) so directionForVector can be unit-tested without a browser.

const KEY_FOR_DIR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

// Geometry in CSS px. Scaled up from the original's point units
// (32 / 16 / 16 / 48) for finger comfort across the wider range of web
// touch screens. All tunable.
const BASE_RADIUS = 52;      // visible ring radius
const KNOB_RADIUS = 26;      // thumb knob radius
const MAX_KNOB_DIST = 42;    // how far the knob travels from the centre
const MAX_FINGER_DIST = 70;  // beyond this the stick centre follows the finger
const DEADZONE = 16;         // no direction until the thumb leaves this radius

// Pure direction mapping: dominant axis wins, with a dead zone around the
// centre. Screen space, so +y points down. On an exact diagonal tie the
// horizontal axis wins. Returns "up" | "down" | "left" | "right" | null.
// Exported so it can be unit-tested without a DOM.
export function directionForVector(dx, dy, deadzone = DEADZONE) {
  if (Math.hypot(dx, dy) < deadzone) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

let zone = null;       // transparent left-side capture region
let base = null;       // the ring drawn at the touch point
let knob = null;       // the thumb knob
let activePointer = null; // pointerId currently driving the stick
let center = { x: 0, y: 0 };
let heldDir = null;
let onMove = null;
let onUp = null;

export function mountJoystick(root) {
  if (zone) return;
  zone = document.createElement("div");
  zone.className = "touch-joystick-zone";
  base = document.createElement("div");
  base.className = "touch-joystick-base";
  knob = document.createElement("div");
  knob.className = "touch-joystick-knob";
  base.style.display = "none";
  knob.style.display = "none";
  root.appendChild(zone);
  root.appendChild(base);
  root.appendChild(knob);
  injectStyles();

  zone.addEventListener("pointerdown", onPointerDown);
  zone.addEventListener("contextmenu", (e) => e.preventDefault());
  // Track move/up on the document so the stick keeps following even when
  // the finger slides outside the capture zone.
  onMove = onPointerMove;
  onUp = onPointerUp;
  document.addEventListener("pointermove", onMove, { passive: false });
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}

export function unmountJoystick() {
  if (!zone) return;
  releaseDir();
  document.removeEventListener("pointermove", onMove);
  document.removeEventListener("pointerup", onUp);
  document.removeEventListener("pointercancel", onUp);
  zone.remove();
  base.remove();
  knob.remove();
  zone = base = knob = null;
  activePointer = null;
  onMove = onUp = null;
}

function onPointerDown(e) {
  if (activePointer !== null) return;
  e.preventDefault();
  activePointer = e.pointerId;
  center = { x: e.clientX, y: e.clientY };
  placeAt(base, center.x, center.y);
  placeAt(knob, center.x, center.y);
  base.style.display = "block";
  knob.style.display = "block";
}

function onPointerMove(e) {
  if (e.pointerId !== activePointer) return;
  e.preventDefault();
  let dx = e.clientX - center.x;
  let dy = e.clientY - center.y;
  let dist = Math.hypot(dx, dy);
  // Auto-pan: once the finger is past MAX_FINGER_DIST, drag the centre
  // along with it so the stick never runs out of travel mid-gesture.
  if (dist > MAX_FINGER_DIST) {
    const angle = Math.atan2(dy, dx);
    const excess = dist - MAX_FINGER_DIST;
    center.x += Math.cos(angle) * excess;
    center.y += Math.sin(angle) * excess;
    placeAt(base, center.x, center.y);
    dx = e.clientX - center.x;
    dy = e.clientY - center.y;
    dist = Math.hypot(dx, dy);
  }
  const angle = Math.atan2(dy, dx);
  const knobDist = Math.min(dist, MAX_KNOB_DIST);
  placeAt(knob, center.x + Math.cos(angle) * knobDist, center.y + Math.sin(angle) * knobDist);
  setDir(directionForVector(dx, dy));
}

function onPointerUp(e) {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  releaseDir();
  if (base) base.style.display = "none";
  if (knob) knob.style.display = "none";
}

function setDir(dir) {
  if (dir === heldDir) return;
  releaseDir();
  if (dir) {
    heldDir = dir;
    dispatchKey("keydown", KEY_FOR_DIR[dir]);
  }
}

function releaseDir() {
  if (!heldDir) return;
  dispatchKey("keyup", KEY_FOR_DIR[heldDir]);
  heldDir = null;
}

function placeAt(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function dispatchKey(type, code) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function injectStyles() {
  if (document.getElementById("touch-joystick-styles")) return;
  const style = document.createElement("style");
  style.id = "touch-joystick-styles";
  style.textContent = `
    #touch-controls .touch-joystick-zone {
      position: absolute;
      left: 0;
      top: 0;
      width: 50vw;
      height: 100%;
      pointer-events: auto;
      touch-action: none;
    }
    #touch-controls .touch-joystick-base,
    #touch-controls .touch-joystick-knob {
      position: absolute;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      pointer-events: none;
      touch-action: none;
    }
    #touch-controls .touch-joystick-base {
      width: ${BASE_RADIUS * 2}px;
      height: ${BASE_RADIUS * 2}px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      opacity: 0.7;
    }
    #touch-controls .touch-joystick-knob {
      width: ${KNOB_RADIUS * 2}px;
      height: ${KNOB_RADIUS * 2}px;
      background: var(--sb-surface-bg-active);
      border: var(--sb-surface-border);
    }
  `;
  document.head.appendChild(style);
}
