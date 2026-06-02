// The pause menu's "Key Bindings" screen: rebind keyboard keys or
// controller buttons, per local player. Split out of menu.js because it
// owns a self-contained chunk of state — which player/device is being
// edited, plus two capture state machines (keyboard via a capture-phase
// keydown listener, controller via a requestAnimationFrame poll of the
// pad). menu.js keeps only the navigation to/from this screen.
//
// The card markup lives in menu.js's template (#menu-controls-*); this
// module is handed the menu root once via initKeyBindingsScreen() and
// drives the list inside it.

import { el } from "./dom.js";
import { ACTIONS, ACTIONS_P2, codesFor, setBinding, resetBindings } from "./keyBindings.js";
import { GAMEPAD_ACTIONS, GAMEPAD_ACTIONS_P2, buttonFor, setGamepadBinding, resetGamepadBindings } from "./gamepadBindings.js";
import { setGamepadCapturing, pressedButtonsForSlot } from "./gamepad.js";
import { formatKeyCode, formatPadButton } from "./inputGlyphs.js";
import { localPlayerCount } from "./coopMode.js";

let root = null;
// Which player's bindings are shown. The P2+ tabs are only visible when
// the local player count covers them. 0 = P1, 1 = P2, …
let controlsPlayer = 0;
// Which input device the screen is editing: "keyboard" (keyBindings.js)
// or "controller" (gamepadBindings.js).
let controlsDevice = "keyboard";
// While non-null, listening for the next keypress to rebind an action.
let rebindCapture = null; // { action, slot, playerIndex, btn } | null
// While non-null, a controller rebind is polling the player's pad for the
// next button press via requestAnimationFrame.
let padCapture = null; // { action, playerIndex, btn, prev, raf } | null

// Wire the static controls (device tabs, player tabs, reset). Called once
// after the menu DOM is built; `menuRoot` is the menu overlay root.
export function initKeyBindingsScreen(menuRoot) {
  root = menuRoot;
  const reset = root.querySelector("#menu-controls-reset");
  reset?.addEventListener("click", () => {
    const who = controlsPlayer === 1 ? "Player 2's" : "Player 1's";
    const what = controlsDevice === "controller" ? "controller bindings" : "key bindings";
    if (!confirm(`Reset ${who} ${what} to their defaults?`)) return;
    if (controlsDevice === "controller") resetGamepadBindings(controlsPlayer);
    else resetBindings(controlsPlayer);
    renderControlsList();
  });
  const device = root.querySelector("#menu-controls-device");
  if (device) {
    for (const btn of device.querySelectorAll(".menu-tab")) {
      btn.addEventListener("click", () => {
        controlsDevice = btn.dataset.device === "controller" ? "controller" : "keyboard";
        resetCaptures();
        renderControlsList();
      });
    }
  }
  const tabs = root.querySelector("#menu-controls-tabs");
  if (tabs) {
    for (const btn of tabs.querySelectorAll(".menu-tab")) {
      btn.addEventListener("click", () => {
        controlsPlayer = parseInt(btn.dataset.player, 10) | 0;
        resetCaptures();
        renderControlsList();
      });
    }
  }
}

export function renderControlsList() {
  if (!root) return;
  const device = root.querySelector("#menu-controls-device");
  if (device) {
    for (const b of device.querySelectorAll(".menu-tab")) {
      b.classList.toggle("active", b.dataset.device === controlsDevice);
    }
  }
  const tabs = root.querySelector("#menu-controls-tabs");
  if (tabs) {
    // Show a player's tab only when the local player count covers them —
    // rebinding a player with no avatar would just persist controls
    // nobody can trigger. The whole row hides in single-player.
    const count = localPlayerCount();
    tabs.style.display = count >= 2 ? "" : "none";
    if (controlsPlayer >= count) controlsPlayer = 0;
    for (const b of tabs.querySelectorAll(".menu-tab")) {
      const idx = parseInt(b.dataset.player, 10) | 0;
      b.style.display = idx < count ? "" : "none";
      b.classList.toggle("active", idx === controlsPlayer);
    }
  }
  const hint = root.querySelector("#menu-controls-hint");
  if (hint) {
    hint.textContent = controlsDevice === "controller"
      ? "Click a binding and press the controller button you want to use. Esc cancels. Movement stays on the stick / d-pad."
      : "Click a binding and press the key you want to use. Esc cancels capture.";
  }
  if (controlsDevice === "controller") renderControllerList();
  else renderKeyboardList();
}

function renderKeyboardList() {
  const list = root.querySelector("#menu-controls-list");
  if (!list) return;
  const actions = controlsPlayer === 0 ? ACTIONS : ACTIONS_P2;
  list.replaceChildren(...actions.map((a) => {
    const codes = codesFor(a.id, controlsPlayer);
    return el("li", {}, [
      el("span", { class: "menu-controls-label", text: a.label }),
      el("button", { class: "menu-controls-key", dataset: { action: a.id, slot: "0" }, text: formatKeyCode(codes[0]) }),
      el("button", { class: "menu-controls-key", dataset: { action: a.id, slot: "1" }, text: formatKeyCode(codes[1]) }),
    ]);
  }));
  for (const btn of list.querySelectorAll(".menu-controls-key")) {
    btn.addEventListener("click", () => beginRebindCapture(btn));
  }
}

function renderControllerList() {
  const list = root.querySelector("#menu-controls-list");
  if (!list) return;
  const actions = controlsPlayer === 0 ? GAMEPAD_ACTIONS : GAMEPAD_ACTIONS_P2;
  list.replaceChildren(...actions.map((a) => {
    const idx = buttonFor(a.id, controlsPlayer);
    return el("li", {}, [
      el("span", { class: "menu-controls-label", text: a.label }),
      el("button", { class: "menu-controls-key", dataset: { action: a.id }, text: formatPadButton(idx) }),
    ]);
  }));
  for (const btn of list.querySelectorAll(".menu-controls-key")) {
    btn.addEventListener("click", () => beginPadCapture(btn));
  }
}

function beginRebindCapture(btn) {
  resetCaptures();
  rebindCapture = {
    action: btn.dataset.action,
    slot: parseInt(btn.dataset.slot, 10),
    playerIndex: controlsPlayer,
    btn,
  };
  btn.classList.add("capturing");
  btn.textContent = "Press a key…";
  window.addEventListener("keydown", onCaptureKeydown, true);
}

function onCaptureKeydown(e) {
  if (!rebindCapture) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === "Escape") { cancelRebindCapture(); renderControlsList(); return; }
  const { action, slot, playerIndex } = rebindCapture;
  setBinding(action, slot, e.code, playerIndex);
  cancelRebindCapture();
  renderControlsList();
}

function cancelRebindCapture() {
  if (!rebindCapture) return;
  rebindCapture.btn?.classList.remove("capturing");
  rebindCapture = null;
  window.removeEventListener("keydown", onCaptureKeydown, true);
}

// Controller rebind: poll the player's pad for the next button press and
// bind it. We snapshot the buttons held at click time and wait for one
// that wasn't already down, so a button still pressed from navigating
// here doesn't bind instantly. setGamepadCapturing(true) keeps that press
// from also firing the action / popping the menu.
function beginPadCapture(btn) {
  resetCaptures();
  const slot = controlsPlayer + 1;
  padCapture = {
    action: btn.dataset.action,
    playerIndex: controlsPlayer,
    btn,
    prev: pressedButtonsForSlot(slot),
    raf: 0,
  };
  btn.classList.add("capturing");
  btn.textContent = "Press a button…";
  setGamepadCapturing(true);
  const tick = () => {
    if (!padCapture) return;
    const now = pressedButtonsForSlot(padCapture.playerIndex + 1);
    for (const b of now) {
      if (!padCapture.prev.has(b)) {
        const { action, playerIndex } = padCapture;
        setGamepadBinding(action, b, playerIndex);
        cancelPadCapture();
        renderControlsList();
        return;
      }
    }
    padCapture.prev = now;
    padCapture.raf = requestAnimationFrame(tick);
  };
  padCapture.raf = requestAnimationFrame(tick);
}

function cancelPadCapture() {
  if (!padCapture) return;
  if (padCapture.raf) cancelAnimationFrame(padCapture.raf);
  padCapture.btn?.classList.remove("capturing");
  padCapture = null;
  setGamepadCapturing(false);
}

// Cancel any in-progress capture (keyboard or controller). Safe to call
// when the screen isn't showing; render-free so callers decide when to
// repaint the list.
export function resetCaptures() {
  cancelRebindCapture();
  cancelPadCapture();
}

// Called by the menu's global keydown BEFORE its menu-toggle logic. While
// a capture is active this screen owns the keyboard: returns true so the
// menu doesn't treat the keystroke as a toggle. Keyboard capture has its
// own capture-phase listener (so we just swallow here); controller
// capture cancels on Escape.
export function consumeMenuKeydown(e) {
  if (rebindCapture) return true;
  if (padCapture) {
    if (e.code === "Escape") { e.preventDefault(); cancelPadCapture(); renderControlsList(); }
    return true;
  }
  return false;
}
