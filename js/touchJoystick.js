// Floating on-screen joystick for touch movement — an alternative to the
// 4-button d-pad in touch.js. Ported from the original Rust game's iOS /
// Android JoystickView: the stick appears wherever the thumb first lands in
// the capture zone (left 75% of the screen), follows the finger when it drags
// past the edge (auto-pan),
// and maps the thumb angle to one of four cardinal directions. Like the
// d-pad it synthesises the same Arrow keydown/keyup events input.js already
// listens for, so nothing downstream knows the input came from a joystick.
//
// Importable in Node (the geometry helper is pure and DOM-free at module
// load) so directionForVector can be unit-tested without a browser.

import { el } from "./dom.js";

const KEY_FOR_DIR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

// Geometry in CSS px. Scaled up from the original's point units
// (32 / 16 / 16 / 48) for finger comfort across the wider range of web
// touch screens. All tunable.
const BASE_RADIUS = 52;      // visible ring radius
const KNOB_RADIUS = 26;      // thumb knob radius
const MAX_KNOB_DIST = 26;    // how far the knob travels from the centre.
                             // Matches the original (maxDistance == leverRadius)
                             // so the lever's edge stops at the base ring instead
                             // of spilling outside it.
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

let zone = null;       // transparent capture region (left 75% of screen)
let base = null;       // the ring drawn at the touch point
let knob = null;       // the thumb knob
let activePointer = null; // pointerId currently driving the stick
let center = { x: 0, y: 0 };
let heldDir = null;
let onMove = null;
let onUp = null;

export function mountJoystick(root) {
  if (zone) return;
  zone = el("div", { class: "touch-joystick-zone" });
  base = el("div", { class: "touch-joystick-base", style: { display: "none" } });
  knob = el("div", { class: "touch-joystick-knob", style: { display: "none" } });
  root.appendChild(zone);
  root.appendChild(base);
  root.appendChild(knob);
  injectStyles();

  zone.addEventListener("pointerdown", onPointerDown);
  zone.addEventListener("contextmenu", (e) => e.preventDefault());
  // The zone is a plain <div>, not a native control like the d-pad <button>s,
  // so on iOS a long hold on the stick (holding a direction to keep moving) is
  // a long-press over magnifiable content and Safari pops its "magnifier loupe"
  // — and Pointer Events' preventDefault doesn't stop it; only the underlying
  // Touch event's does. Suppress it at touchstart. Listener must be non-passive
  // for preventDefault to take effect; pointerdown still fires for the stick.
  zone.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
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

function placeAt(node, x, y) {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

function dispatchKey(type, code) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function injectStyles() {
  if (document.getElementById("touch-joystick-styles")) return;
  const style = document.createElement("style");
  style.id = "touch-joystick-styles";
  style.textContent = `
    /* Capture the left 75% of the screen — but NOT the top strip, which the
       HUD bar (☰ menu / HP / coins / ammo) owns. The bar sits at a lower
       z-index than this overlay, so without the top inset a thumb landing on
       the menu button would start the stick instead of tapping the button.
       The reserved band clears the bar (top:12px + its height) plus any
       notch/safe-area. */
    #touch-controls .touch-joystick-zone {
      position: absolute;
      left: 0;
      top: calc(env(safe-area-inset-top, 0px) + 60px);
      bottom: 0;
      width: 75vw;
      pointer-events: auto;
      touch-action: none;
      /* Belt-and-braces with the touchstart preventDefault above: kill text
         selection and the iOS long-press callout/loupe over the stick region. */
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
    }
    /* Drawn from the shared HUD tokens (uiTokens.js) rather than pixel-art
       sprites, so the stick reads as part of the same UI as the chips and
       touch buttons: a translucent dark "well" for the base, and a lighter
       raised knob (the same surface a pressed button uses) so the moveable
       part stands out. */
    #touch-controls .touch-joystick-base,
    #touch-controls .touch-joystick-knob {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: none;
      touch-action: none;
      border-radius: 50%;
      box-sizing: border-box;
    }
    #touch-controls .touch-joystick-base {
      width: ${BASE_RADIUS * 2}px;
      height: ${BASE_RADIUS * 2}px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.45);
    }
    #touch-controls .touch-joystick-knob {
      width: ${KNOB_RADIUS * 2}px;
      height: ${KNOB_RADIUS * 2}px;
      background: var(--sb-surface-bg-active);
      border: var(--sb-surface-border);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
    }
  `;
  document.head.appendChild(style);
}

// — First-launch demo ————————————————————————————————————————————————————
// A transient, non-interactive copy of the stick that appears once on first
// launch, orbits its knob around the ring twice to advertise "this is an
// analog stick — push it any direction," then fades out. Self-contained
// (own elements + styles) so it never touches the live pointer state above.
// Skipped under prefers-reduced-motion.
const HINT_RADIUS = MAX_KNOB_DIST;     // how far the knob orbits from centre
const HINT_DURATION_MS = 3300;         // total lifetime incl. fade in/out

export function playJoystickHint() {
  if (typeof document === "undefined") return;
  if (document.getElementById("touch-joystick-hint")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  injectHintStyles();
  const hint = el("div", { id: "touch-joystick-hint" }, [
    el("div", { class: "jh-pulse" }),
    el("div", { class: "jh-base" }),
    el("div", { class: "jh-knob" }),
  ]);
  document.body.appendChild(hint);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.removeEventListener("pointerdown", cleanup);
    hint.remove();
  };
  // animationend on the container's fade is the natural end; the timeout is a
  // belt-and-braces fallback in case the event never fires.
  hint.addEventListener("animationend", (e) => {
    if (e.target === hint) cleanup();
  });
  // The moment the player reaches for the real stick, drop the demo so the two
  // never show at once.
  document.addEventListener("pointerdown", cleanup);
  setTimeout(cleanup, HINT_DURATION_MS + 200);
}

// One full orbit of the knob = eight cardinal/diagonal samples. The keyframe
// ramps out from centre, circles twice, then settles back to centre, so there
// is no visible jump at the start or end. translate(-50%,-50%) keeps the knob
// centred on the anchor; the second translate is the orbit offset.
function orbitKeyframes() {
  const R = HINT_RADIUS;
  const d = R * 0.707;                 // diagonal component (cos45 * R)
  const ring = [
    [R, 0], [d, d], [0, R], [-d, d], [-R, 0], [-d, -d], [0, -R], [d, -d],
  ];
  const at = (pct, x, y) =>
    `      ${pct.toFixed(2)}% { transform: translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px); }`;
  const frames = [at(0, 0, 0)];        // start at centre
  // Two orbits across 6%..94%, eight samples each (+ the closing point).
  const start = 6, end = 94, span = end - start;
  for (let i = 0; i <= 16; i++) {
    const pct = start + (span * i) / 16;
    const [x, y] = ring[i % 8];
    frames.push(at(pct, x, y));
  }
  frames.push(at(100, 0, 0));          // settle back to centre
  return frames.join("\n");
}

function injectHintStyles() {
  if (document.getElementById("touch-joystick-hint-styles")) return;
  const style = document.createElement("style");
  style.id = "touch-joystick-hint-styles";
  style.textContent = `
    #touch-joystick-hint {
      position: fixed;
      left: 18vw;
      bottom: 26vh;
      width: 0;
      height: 0;
      z-index: 13;
      pointer-events: none;
      animation: jh-fade ${HINT_DURATION_MS}ms ease-in-out forwards;
    }
    #touch-joystick-hint .jh-base,
    #touch-joystick-hint .jh-knob,
    #touch-joystick-hint .jh-pulse {
      position: absolute;
      left: 0;
      top: 0;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      box-sizing: border-box;
    }
    #touch-joystick-hint .jh-base {
      width: ${BASE_RADIUS * 2}px;
      height: ${BASE_RADIUS * 2}px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.45);
    }
    #touch-joystick-hint .jh-knob {
      width: ${KNOB_RADIUS * 2}px;
      height: ${KNOB_RADIUS * 2}px;
      background: var(--sb-surface-bg-active);
      border: var(--sb-surface-border);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
      animation: jh-orbit 2400ms ease-in-out 350ms 1 both;
    }
    /* A ring that expands out of the base twice — the "tap me" cue. */
    #touch-joystick-hint .jh-pulse {
      width: ${BASE_RADIUS * 2}px;
      height: ${BASE_RADIUS * 2}px;
      border: var(--sb-surface-border);
      animation: jh-pulse 1100ms ease-out 250ms 2 both;
    }
    @keyframes jh-fade {
      0%   { opacity: 0; }
      11%  { opacity: 1; }
      85%  { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes jh-pulse {
      0%   { transform: translate(-50%, -50%) scale(0.55); opacity: 0.55; }
      100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
    }
    @keyframes jh-orbit {
${orbitKeyframes()}
    }
  `;
  document.head.appendChild(style);
}
