// Keyboard + controller navigation for the DOM menu surfaces. Gives every
// overlay roving focus with a visible highlight so the game is fully
// playable without a mouse (Steam Full Controller Support).
//
// Surfaces register { root, isOpen, onConfirm?, priority? }. The nav core
// (move / moveHorizontal / confirm / back) is shared: the keyboard listener
// here drives it for arrow keys, and gamepad.js calls the same functions
// in menu mode — so keyboard and controller behave identically and the
// active-input-device (glyph) state isn't disturbed.
//
// Convention: Up/Down move the highlight; Left/Right adjust the focused
// control (slider value via native handling, tab switch) else move; confirm
// activates (A / native Enter); back dismisses (B / Esc) by reusing each
// surface's existing Escape handler.

const surfaces = [];
let stylesInjected = false;

export function registerMenuSurface(surface) {
  surfaces.push({ priority: 0, ...surface });
  ensureStyles();
  ensureKeyListener();
}

function resolveRoot(s) {
  return typeof s.root === "function" ? s.root() : s.root;
}

// The open surface that should receive input — highest priority wins (so a
// modal on top of the pause menu takes over), ties broken by latest
// registration.
function activeSurface() {
  let best = null;
  for (const s of surfaces) {
    if (!s.isOpen || !s.isOpen()) continue;
    if (!best || s.priority >= best.priority) best = s;
  }
  return best;
}

export function isMenuNavActive() { return !!activeSurface(); }

function focusablesIn(root) {
  if (!root) return [];
  const sel = 'button, input, select, [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll(sel)].filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
}

function setHighlight(el) {
  if (typeof document !== "undefined") {
    for (const prev of document.querySelectorAll(".nav-focused")) {
      prev.classList.remove("nav-focused");
    }
  }
  if (el) {
    el.classList.add("nav-focused");
    try { el.focus({ preventScroll: false }); } catch { el.focus(); }
  }
}

// Focus the first interactive element of a surface (called on open for an
// immediate highlight). Accepts an element or a getter.
export function focusFirstIn(rootOrGetter) {
  const root = typeof rootOrGetter === "function" ? rootOrGetter() : rootOrGetter;
  const items = focusablesIn(root);
  if (items.length) setHighlight(items[0]);
}

export function move(delta) {
  const s = activeSurface();
  if (!s) return;
  const items = focusablesIn(resolveRoot(s));
  if (!items.length) return;
  const cur = items.indexOf(document.activeElement);
  const next = cur < 0 ? 0 : (cur + delta + items.length) % items.length;
  setHighlight(items[next]);
}

export function moveHorizontal(delta) {
  const el = document.activeElement;
  // Tab strips: hop to the adjacent tab and activate it.
  if (el && el.classList?.contains("menu-tab")) {
    const tabs = [...el.parentElement.querySelectorAll(".menu-tab")]
      .filter((t) => t.offsetParent !== null);
    const i = tabs.indexOf(el);
    const t = tabs[(i + delta + tabs.length) % tabs.length];
    if (t) { t.click(); setHighlight(t); }
    return;
  }
  // Inputs (range/text) handle horizontal natively (value / cursor).
  if (el && el.tagName === "INPUT") return;
  move(delta);
}

export function confirm() {
  const s = activeSurface();
  if (!s) return;
  if (typeof s.onConfirm === "function") { s.onConfirm(); return; }
  const el = document.activeElement;
  if (el && resolveRoot(s)?.contains(el)) el.click();
}

// Reuse every surface's existing Escape handler for "back".
export function back() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
}

let keyListenerInstalled = false;
function ensureKeyListener() {
  if (keyListenerInstalled || typeof window === "undefined") return;
  keyListenerInstalled = true;
  window.addEventListener("keydown", (e) => {
    if (!isMenuNavActive()) return;
    switch (e.code) {
      case "ArrowUp":    move(-1); e.preventDefault(); break;
      case "ArrowDown":  move(1);  e.preventDefault(); break;
      case "ArrowLeft":
        if (document.activeElement?.tagName !== "INPUT") { moveHorizontal(-1); e.preventDefault(); }
        break;
      case "ArrowRight":
        if (document.activeElement?.tagName !== "INPUT") { moveHorizontal(1); e.preventDefault(); }
        break;
      // Enter/Space (native button activation) and Escape (each surface's
      // own handler) are intentionally left alone.
    }
  });
  // Debug/e2e hook to exercise the gamepad code path without a virtual pad.
  window.__menuNav = { move, moveHorizontal, confirm, back, isMenuNavActive };
}

function ensureStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "menu-nav-styles";
  style.textContent = `
    .nav-focused {
      outline: 2px solid #6af !important;
      outline-offset: 1px;
      box-shadow: 0 0 0 2px rgba(102,170,255,0.35) !important;
      border-radius: 4px;
    }
    .nav-focused:is(button, .menu-tab) { background: #2f3b55 !important; }
  `;
  document.head.appendChild(style);
}
