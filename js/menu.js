// HTML pause/settings overlay. Esc toggles. Lives outside the canvas so we
// can style it with CSS and bind real form widgets.
//
// One overlay, two screens: a short pause menu that links to a settings
// screen. isMenuOpen() reports either screen as "open" so the game stays
// paused while the player tweaks audio.

import { getSettings, saveSettings } from "./settings.js?v=20260529a";
import { playSfx } from "./audio.js?v=20260529a";
import { APP_VERSION } from "./constants.js?v=20260529a";
import { clearProgress } from "./save.js?v=20260529a";
import { getSkills } from "./skills.js?v=20260529a";
import { renderInventoryInto } from "./inventoryScreen.js?v=20260529a";
import { isCreativeMode } from "./creativeMode.js?v=20260529a";
import { ACTIONS, ACTIONS_P2, codesFor, setBinding, resetBindings, onBindingsChange, matchesAction } from "./keyBindings.js?v=20260529a";
import { GAMEPAD_ACTIONS, GAMEPAD_ACTIONS_P2, buttonFor, setGamepadBinding, resetGamepadBindings } from "./gamepadBindings.js?v=20260529a";
import { setGamepadCapturing, pressedButtonsForSlot } from "./gamepad.js?v=20260529a";
import { isCoopMode, isCoopActive } from "./coopMode.js?v=20260529a";
import { putBufferedZone, clearBufferedZone } from "./zoneBuffer.js?v=20260529a";
import { invalidateZoneCache } from "./data.js?v=20260529a";
import { openPartyPanel, isPartyPanelOpen } from "./partyPanel.js?v=20260529a";
import { isGameOverOpen } from "./gameOver.js?v=20260529a";
import { isFastTravelOpen } from "./fastTravel.js?v=20260529a";
import { isMessageOpen } from "./message.js?v=20260529a";
import { isDialogueOpen } from "./dialogue.js?v=20260529a";
import { getRuntimeRole, onRoleChange } from "./onlineMode.js?v=20260529a";

// Modals that own the keyboard while they're up. If any is open we treat
// Esc / the menu key as "dismiss the active modal" — owned by that modal's
// own listener — and don't pop the pause menu on top of it.
function isAnotherModalOpen() {
  return isGameOverOpen()
    || isFastTravelOpen()
    || isMessageOpen()
    || isDialogueOpen()
    || isPartyPanelOpen();
}

let root = null;
let open = false;
let screen = "pause"; // "pause" | "settings" | "skills" | "credits" | "inventory" | "controls"
// Which player's bindings are shown on the Key Bindings screen. The P2
// tab is only visible when local co-op is on (no point rebinding P2 if
// they're not spawned). 0 = P1, 1 = P2.
let controlsPlayer = 0;
// Which input device the Key Bindings screen is editing: "keyboard"
// (keyBindings.js) or "controller" (gamepadBindings.js).
let controlsDevice = "keyboard";
// While non-null, we're listening for the next keypress to rebind an
// action. The captured binding is written via setBinding(action, slot,
// code, playerIndex).
let rebindCapture = null; // { action, slot, playerIndex } | null
// While non-null, a controller rebind is capturing the next button press
// via a requestAnimationFrame poll of the player's pad.
let padCapture = null; // { action, playerIndex, btn, prev, raf } | null

// Standard-Mapping button labels for the controller bindings UI.
const PAD_BUTTON_LABELS = {
  0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT",
  8: "Back", 9: "Start", 10: "LS", 11: "RS",
  12: "D-Up", 13: "D-Down", 14: "D-Left", 15: "D-Right", 16: "Guide",
};
function padButtonLabel(idx) {
  if (idx == null || idx < 0) return "—";
  return PAD_BUTTON_LABELS[idx] || `Button ${idx}`;
}
// Optional getter the host wires in at install time. Provides access to
// the live game state (rawZone + current zone id) without coupling the
// menu module to main.js. Returns null when no state is wired or when
// installMenu was called without a getter (e.g. early-init / tests).
let getState = () => null;

// Desktop-only probe — matches the touch overlay's gate in js/touch.js.
// Creative-mode editor + Save / Reset / Export are click-and-drag tools
// that don't have a sensible thumb UI, so we hide them on coarse pointers.
function isDesktop() {
  if (typeof matchMedia === "undefined") return true;
  return !matchMedia("(pointer: coarse)").matches;
}

export function installMenu(stateGetter) {
  if (typeof stateGetter === "function") getState = stateGetter;
  if (root) return root;
  root = document.createElement("div");
  root.id = "menu";
  root.innerHTML = `
    <div class="menu-card" data-screen="pause">
      <h1>SneakBit</h1>
      <div class="menu-row menu-controls menu-stack">
        <button id="menu-resume">Resume (Esc)</button>
        <button id="menu-open-party">Party / Co-op</button>
        <button id="menu-open-inventory">Inventory &amp; Equipment</button>
        <button id="menu-open-skills">Skills</button>
        <button id="menu-open-settings">Settings</button>
        <button id="menu-export-save" data-creative-only>Export save (copy JSON)</button>
        <button id="menu-import-save" data-creative-only>Import save (paste JSON)</button>
        <button id="menu-save-zone" data-creative-only data-desktop-only>Save zone (flush to buffer)</button>
        <button id="menu-export-zone" data-creative-only data-desktop-only>Export zone JSON…</button>
        <button id="menu-reset-zone" data-creative-only data-desktop-only>Reset zone (revert to shipped)</button>
        <button id="menu-open-map-editor" data-creative-only data-desktop-only>Map editor…</button>
        <button id="menu-open-credits">Credits</button>
        <button id="menu-new-game" data-guest-hidden>New game (wipe save)</button>
        <button id="menu-clear-cache" data-guest-hidden>Clear cache &amp; reload</button>
      </div>
      <p class="menu-hint">
        WASD / arrows to move &middot; E or Enter to interact<br>
        F to throw a kunai &middot; G to swing melee &middot; Esc to toggle menu
      </p>
      <p class="menu-version">v${APP_VERSION}</p>
    </div>
    <div class="menu-card" data-screen="settings">
      <h1>Settings</h1>
      <div class="menu-row">
        <label for="opt-sfx-volume">SFX</label>
        <input id="opt-sfx-volume" type="range" min="0" max="100" step="1" />
        <span id="opt-sfx-volume-val"></span>
      </div>
      <div class="menu-row">
        <label for="opt-music-volume">Music</label>
        <input id="opt-music-volume" type="range" min="0" max="100" step="1" />
        <span id="opt-music-volume-val"></span>
      </div>
      <div class="menu-row">
        <label for="opt-muted"><input id="opt-muted" type="checkbox" /> Mute all</label>
      </div>
      <div class="menu-row">
        <label for="opt-fps"><input id="opt-fps" type="checkbox" /> Show FPS</label>
      </div>
      <div class="menu-row" id="opt-friendly-fire-row">
        <label for="opt-friendly-fire"><input id="opt-friendly-fire" type="checkbox" /> Friendly fire (co-op)</label>
      </div>
      <div class="menu-row menu-controls">
        <button id="menu-open-controls">Key bindings…</button>
        <button id="menu-settings-back">Back</button>
      </div>
    </div>
    <div class="menu-card" data-screen="controls">
      <h1>Key Bindings</h1>
      <div class="menu-tabs" id="menu-controls-device">
        <button class="menu-tab" data-device="keyboard">Keyboard</button>
        <button class="menu-tab" data-device="controller">Controller</button>
      </div>
      <div class="menu-tabs" id="menu-controls-tabs">
        <button class="menu-tab" data-player="0">Player 1</button>
        <button class="menu-tab" data-player="1">Player 2</button>
      </div>
      <ul class="menu-controls-list" id="menu-controls-list"></ul>
      <p class="menu-hint" id="menu-controls-hint">
        Click a binding and press the key you want to use. Esc cancels capture.
      </p>
      <div class="menu-row menu-controls">
        <button id="menu-controls-reset">Reset to defaults</button>
        <button id="menu-controls-back">Back</button>
      </div>
    </div>
    <div class="menu-card" data-screen="skills">
      <h1>Skills</h1>
      <ul class="menu-skills" id="menu-skill-list"></ul>
      <p class="menu-hint">
        Earn skills from the three ninja questlines (red / black / blue).
      </p>
      <div class="menu-row menu-controls">
        <button id="menu-skills-back">Back</button>
      </div>
    </div>
    <div class="menu-card" data-screen="inventory">
      <h1>Inventory</h1>
      <div id="menu-inventory-body"></div>
      <div class="menu-row menu-controls">
        <button id="menu-inventory-back">Back</button>
      </div>
    </div>
    <div class="menu-card" data-screen="credits">
      <h1>Credits</h1>
      <p class="menu-credits">
        <strong>SneakBit</strong> · web port of the
        <a href="https://github.com/curzel-it/sneakbit" target="_blank" rel="noopener">original Rust build</a>.
      </p>
      <p class="menu-credits">
        Web port source:
        <a href="https://github.com/curzel-it/sneakbit-html" target="_blank" rel="noopener">github.com/curzel-it/sneakbit-html</a>
      </p>
      <p class="menu-credits">
        Music by <a href="https://www.filippovicarelli.com/8bit-game-background-music" target="_blank" rel="noopener">Filippo Vicarelli</a><br>
        Sound effects by <a href="https://opengameart.org/content/512-sound-effects-8-bit-style" target="_blank" rel="noopener">SubspaceAudio</a><br>
        Font by <a href="https://dl.dafont.com/dl/?f=pixel_operator" target="_blank" rel="noopener">HarvettFox96</a>
      </p>
      <div class="menu-row menu-controls">
        <button id="menu-credits-back">Back</button>
      </div>
    </div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(2px)",
    zIndex: "20",
    color: "#eee",
    fontFamily: "monospace",
  });
  document.body.appendChild(root);
  injectStyles();
  bindWidgets();
  applyCreativeModeVisibility();
  applyRoleVisibility();
  // Keep the role gates live across role transitions — if the menu is
  // already open when the user joins a session, the buttons should
  // disappear without waiting for a close/reopen.
  onRoleChange(() => { if (root) applyRoleVisibility(); });

  window.addEventListener("keydown", (e) => {
    // Settings screen is doing live key capture for rebinding; don't
    // hijack the keystroke as a menu toggle. Esc still backs out of
    // the capture itself (handled in the rebinding flow below).
    if (rebindCapture) return;
    // A controller rebind is waiting for a button — Esc cancels it
    // (instead of toggling the menu), any other key is ignored.
    if (padCapture) {
      if (e.code === "Escape") { e.preventDefault(); cancelPadCapture(); renderControlsList(); }
      return;
    }
    if (!matchesAction("menu", e.code) && e.code !== "Escape") return;
    // If another modal already owns Esc (game over, fast travel, message,
    // dialogue, party panel) let that modal handle the keystroke. Without
    // this the pause menu pops on top of e.g. the You-Died screen the
    // moment the player tries to dismiss it.
    if (!open && isAnotherModalOpen()) return;
    e.preventDefault();
    if (!open) { openMenu(); return; }
    if (screen !== "pause") { showScreen("pause"); return; }
    closeMenu();
  });
  return root;
}

export function isMenuOpen() { return open; }

// Save export/import are creative-mode-only — they map onto the Rust
// build's "Save" menu entry (game/src/gameui/game_menu.rs only shows
// save-related actions when GameMode::Creative). In the regular
// player-facing build, progress is saved automatically and there's no
// need to expose JSON blobs.

function applyCreativeModeVisibility() {
  const creative = isCreativeMode();
  const desktop = isDesktop();
  // Two attributes, ANDed: a [data-creative-only] entry hides outside
  // creative; [data-desktop-only] additionally hides on coarse-pointer
  // devices where the click-and-drag editor + Save/Export wouldn't be
  // usable. Most existing entries only carry [data-creative-only]; the
  // editor and zone-buffer actions carry both.
  root.querySelectorAll("[data-creative-only]").forEach((el) => {
    const requiresDesktop = el.hasAttribute("data-desktop-only");
    const show = creative && (!requiresDesktop || desktop);
    el.style.display = show ? "" : "none";
  });
}

// "New Game" and "Clear cache" both wipe localStorage, which includes
// the online UUID this tab uses as its stable identity. A guest doing
// that mid-session would lose their seat (the server would treat the
// next reconnect as a fresh peer). So we hide both buttons whenever
// runtime role is guest, and re-show on every other role transition.
function applyRoleVisibility() {
  const isGuest = getRuntimeRole() === "guest";
  root.querySelectorAll("[data-guest-hidden]").forEach((el) => {
    el.style.display = isGuest ? "none" : "";
  });
}

function openMenu() {
  open = true;
  showScreen("pause");
  applyRoleVisibility();
  root.style.display = "flex";
  playSfx("hintReceived", { volume: 0.5 });
}

function closeMenu() {
  open = false;
  cancelPadCapture();
  root.style.display = "none";
  playSfx("hintReceived", { volume: 0.5 });
}

function showScreen(next) {
  screen = next;
  root.querySelectorAll(".menu-card").forEach(card => {
    card.style.display = card.dataset.screen === next ? "block" : "none";
  });
  if (next === "settings") syncSettingsWidgets();
  if (next === "skills") syncSkillsWidgets();
  if (next === "inventory") renderInventoryInto(root.querySelector("#menu-inventory-body"));
  if (next === "controls") renderControlsList();
  if (next !== "controls") { cancelRebindCapture(); cancelPadCapture(); }
}

function renderControlsList() {
  const device = root.querySelector("#menu-controls-device");
  if (device) {
    for (const b of device.querySelectorAll(".menu-tab")) {
      b.classList.toggle("active", b.dataset.device === controlsDevice);
    }
  }
  const tabs = root.querySelector("#menu-controls-tabs");
  if (tabs) {
    // Hide the P2 tab outside of local co-op — when there's no second
    // player avatar, rebinding their controls would just persist defaults
    // nobody can trigger.
    const coop = isCoopMode();
    tabs.style.display = coop ? "" : "none";
    if (!coop) controlsPlayer = 0;
    for (const b of tabs.querySelectorAll(".menu-tab")) {
      const idx = parseInt(b.dataset.player, 10) | 0;
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
  const actions = controlsPlayer === 1 ? ACTIONS_P2 : ACTIONS;
  list.innerHTML = actions.map((a) => {
    const codes = codesFor(a.id, controlsPlayer);
    return `<li>
      <span class="menu-controls-label">${a.label}</span>
      <button class="menu-controls-key" data-action="${a.id}" data-slot="0">${formatCode(codes[0])}</button>
      <button class="menu-controls-key" data-action="${a.id}" data-slot="1">${formatCode(codes[1])}</button>
    </li>`;
  }).join("");
  for (const btn of list.querySelectorAll(".menu-controls-key")) {
    btn.addEventListener("click", () => beginRebindCapture(btn));
  }
}

function renderControllerList() {
  const list = root.querySelector("#menu-controls-list");
  if (!list) return;
  const actions = controlsPlayer === 1 ? GAMEPAD_ACTIONS_P2 : GAMEPAD_ACTIONS;
  list.innerHTML = actions.map((a) => {
    const idx = buttonFor(a.id, controlsPlayer);
    return `<li>
      <span class="menu-controls-label">${a.label}</span>
      <button class="menu-controls-key" data-action="${a.id}">${padButtonLabel(idx)}</button>
    </li>`;
  }).join("");
  for (const btn of list.querySelectorAll(".menu-controls-key")) {
    btn.addEventListener("click", () => beginPadCapture(btn));
  }
}

function formatCode(code) {
  if (!code) return "—";
  // Browser KeyboardEvent.code values like "KeyA", "ArrowUp", "Digit1".
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

function beginRebindCapture(btn) {
  cancelRebindCapture();
  cancelPadCapture();
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
  if (e.code === "Escape") { cancelRebindCapture(); return; }
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
  // Re-render so a cancelled button reverts to its old label.
  if (screen === "controls") renderControlsList();
}

// Controller rebind: poll the player's pad for the next button press and
// bind it. We snapshot the buttons held at click time and wait for one
// that wasn't already down, so a button still pressed from navigating
// here doesn't bind instantly. setGamepadCapturing(true) keeps that press
// from also firing the action / popping the menu.
function beginPadCapture(btn) {
  cancelRebindCapture();
  cancelPadCapture();
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

const SKILL_LABELS = [
  { id: "piercing",  name: "Piercing Kunai",  desc: "Kunai deals 2× damage." },
  { id: "boomerang", name: "Boomerang Kunai", desc: "Kunai bounces back on wall/kill." },
  { id: "catcher",   name: "Bullet Catcher",  desc: "Caught bullets refund into ammo." },
];

function syncSkillsWidgets() {
  const list = root.querySelector("#menu-skill-list");
  if (!list) return;
  const skills = getSkills();
  list.innerHTML = SKILL_LABELS.map(s => {
    const unlocked = !!skills[s.id];
    const tag = unlocked ? `<span class="menu-skill-tag on">UNLOCKED</span>`
                         : `<span class="menu-skill-tag off">LOCKED</span>`;
    return `<li class="${unlocked ? "on" : "off"}">
      <div class="menu-skill-head">${s.name} ${tag}</div>
      <div class="menu-skill-desc">${s.desc}</div>
    </li>`;
  }).join("");
}

function bindWidgets() {
  root.querySelector("#menu-resume").addEventListener("click", closeMenu);
  root.querySelector("#menu-open-party").addEventListener("click", () => {
    closeMenu();
    openPartyPanel();
  });
  root.querySelector("#menu-open-settings").addEventListener("click", () => showScreen("settings"));
  root.querySelector("#menu-open-skills").addEventListener("click", () => showScreen("skills"));
  root.querySelector("#menu-open-credits").addEventListener("click", () => showScreen("credits"));
  root.querySelector("#menu-open-inventory").addEventListener("click", () => showScreen("inventory"));
  root.querySelector("#menu-settings-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-open-controls").addEventListener("click", () => showScreen("controls"));
  root.querySelector("#menu-controls-back").addEventListener("click", () => showScreen("settings"));
  root.querySelector("#menu-controls-reset").addEventListener("click", () => {
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
        cancelRebindCapture();
        cancelPadCapture();
        renderControlsList();
      });
    }
  }
  const tabs = root.querySelector("#menu-controls-tabs");
  if (tabs) {
    for (const btn of tabs.querySelectorAll(".menu-tab")) {
      btn.addEventListener("click", () => {
        controlsPlayer = parseInt(btn.dataset.player, 10) | 0;
        cancelRebindCapture();
        cancelPadCapture();
        renderControlsList();
      });
    }
  }
  root.querySelector("#menu-skills-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-credits-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-inventory-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-export-save").addEventListener("click", exportSave);
  root.querySelector("#menu-import-save").addEventListener("click", importSave);
  root.querySelector("#menu-save-zone").addEventListener("click", saveZoneNow);
  root.querySelector("#menu-export-zone").addEventListener("click", exportZone);
  root.querySelector("#menu-reset-zone").addEventListener("click", resetZone);
  root.querySelector("#menu-open-map-editor").addEventListener("click", () => {
    closeMenu();
    window.creative?.openMapEditor?.();
  });
  root.querySelector("#menu-new-game").addEventListener("click", () => {
    if (!confirm("Wipe save and start over? Inventory, dialogue progress and unlocked skills will be reset.")) return;
    // Tell main.js's beforeunload listener to stand down — otherwise it
    // re-saves the player's current zone+tile on top of the cleared
    // payload during the reload, and we'd end up right back where we
    // started.
    try { window.save?.suppressUnloadSave?.(); } catch {}
    try { localStorage.clear(); } catch {}
    clearProgress();
    // A `?zone=X` query overrides saved progress in main.js. After wiping
    // the save we also need to drop the URL override or the player would
    // reload back into the same zone at the same tile.
    location.replace(location.pathname);
  });
  root.querySelector("#menu-clear-cache").addEventListener("click", () => {
    try { window.save?.suppressUnloadSave?.(); } catch {}
    try { localStorage.clear(); } catch {}
    location.replace(location.pathname);
  });

  const sfx = root.querySelector("#opt-sfx-volume");
  const sfxVal = root.querySelector("#opt-sfx-volume-val");
  const music = root.querySelector("#opt-music-volume");
  const musicVal = root.querySelector("#opt-music-volume-val");
  const muted = root.querySelector("#opt-muted");
  const fps = root.querySelector("#opt-fps");

  sfx.addEventListener("input", () => {
    saveSettings({ sfxVolume: parseInt(sfx.value, 10) / 100 });
    sfxVal.textContent = `${sfx.value}%`;
  });
  sfx.addEventListener("change", () => playSfx("hintReceived", { volume: 0.5 }));
  music.addEventListener("input", () => {
    saveSettings({ musicVolume: parseInt(music.value, 10) / 100 });
    musicVal.textContent = `${music.value}%`;
  });
  muted.addEventListener("change", () => saveSettings({ muted: muted.checked }));
  fps.addEventListener("change", () => saveSettings({ showFps: fps.checked }));

  const ff = root.querySelector("#opt-friendly-fire");
  ff.addEventListener("change", () => saveSettings({ friendlyFire: ff.checked }));
}

function syncSettingsWidgets() {
  const s = getSettings();
  const sfx = Math.round((s.sfxVolume ?? 0) * 100);
  const music = Math.round((s.musicVolume ?? 0) * 100);
  root.querySelector("#opt-sfx-volume").value = String(sfx);
  root.querySelector("#opt-sfx-volume-val").textContent = `${sfx}%`;
  root.querySelector("#opt-music-volume").value = String(music);
  root.querySelector("#opt-music-volume-val").textContent = `${music}%`;
  root.querySelector("#opt-muted").checked = !!s.muted;
  root.querySelector("#opt-fps").checked = !!s.showFps;
  root.querySelector("#opt-friendly-fire").checked = !!s.friendlyFire;
  // Friendly fire is meaningless without a second hero in the world —
  // hide the row entirely unless local co-op is on or a network guest
  // is connected. `isCoopActive()` covers both.
  const ffRow = root.querySelector("#opt-friendly-fire-row");
  if (ffRow) ffRow.style.display = isCoopActive() ? "" : "none";
}

// Flush the in-memory raw zone JSON to the IndexedDB override buffer
// without leaving the current zone. Mirrors the Rust desktop's "Save"
// menu action — engine.save() writes the current zone to disk on
// demand. Useful between teleports so creative work is durable even if
// the tab is closed before the next zone transition.
async function saveZoneNow() {
  const st = getState();
  const id = st?.zone?.id;
  const raw = st?.rawZone;
  if (!id || !raw) { alert("No zone is loaded yet."); return; }
  try {
    await putBufferedZone(id, raw);
    invalidateZoneCache(id);
    alert(`Saved zone ${id} to the creative buffer.`);
  } catch (e) {
    alert(`Save failed: ${e?.message ?? "unknown error"}`);
  }
}

// Download the current zone's raw JSON as `{id}.json`. The author drops
// the file into ./data/ and commits — that's the canonical "ship the
// edit" path described in creative-mode-requirements.md.
function exportZone() {
  const st = getState();
  const id = st?.zone?.id;
  const raw = st?.rawZone;
  if (!id || !raw) { alert("No zone is loaded yet."); return; }
  const json = JSON.stringify(raw, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick — Firefox cancels the download if the URL is
  // freed before the browser starts streaming the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Drop the IndexedDB override for the current zone. The next reload
// (or teleport back) falls through to the shipped ./data/{id}.json.
async function resetZone() {
  const st = getState();
  const id = st?.zone?.id;
  if (!id) { alert("No zone is loaded yet."); return; }
  if (!confirm(`Reset zone ${id} to the shipped version? Any buffered creative edits will be discarded on next reload.`)) return;
  try {
    await clearBufferedZone(id);
    invalidateZoneCache(id);
    alert(`Cleared creative buffer for zone ${id}. Reload (or teleport in/out) to see the shipped version.`);
  } catch (e) {
    alert(`Reset failed: ${e?.message ?? "unknown error"}`);
  }
}

// Snapshot every sneakbit.* localStorage key into a JSON blob and try to
// copy it to the clipboard; on failure (clipboard API blocked, http
// without secure-context) fall back to a textarea-and-Ctrl-C prompt so
// the player can still grab it.
async function exportSave() {
  const payload = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sneakbit.")) continue;
      payload[k] = localStorage.getItem(k);
    }
  } catch {}
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries: payload });
  try {
    await navigator.clipboard.writeText(json);
    alert(`Save exported to clipboard (${Object.keys(payload).length} keys).`);
  } catch {
    prompt("Save export — copy the text below:", json);
  }
}

// Replace the current sneakbit.* localStorage payload with the contents
// of a pasted JSON blob (produced by exportSave). Reloads on success so
// every module hydrates fresh from the restored values.
function importSave() {
  const json = prompt("Paste your previously-exported save JSON:");
  if (!json) return;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    alert("That doesn't look like valid JSON.");
    return;
  }
  if (!parsed?.entries || typeof parsed.entries !== "object") {
    alert("Missing 'entries' object in save payload.");
    return;
  }
  if (!confirm("Importing will overwrite your current progress. Continue?")) return;
  try { window.save?.suppressUnloadSave?.(); } catch {}
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sneakbit.")) localStorage.removeItem(k);
    }
    for (const [k, v] of Object.entries(parsed.entries)) {
      if (typeof k === "string" && k.startsWith("sneakbit.") && typeof v === "string") {
        localStorage.setItem(k, v);
      }
    }
  } catch (e) {
    alert(`Import failed: ${e?.message ?? "unknown error"}`);
    return;
  }
  location.replace(location.pathname);
}

function injectStyles() {
  if (document.getElementById("menu-styles")) return;
  const css = `
    #menu .menu-card {
      background: #181818;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 24px 28px;
      min-width: 320px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    #menu h1 { margin: 0 0 16px; font-size: 18px; letter-spacing: 1px; }
    #menu .menu-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
    #menu .menu-stack { flex-direction: column; align-items: stretch; gap: 8px; }
    #menu label { color: #ddd; cursor: pointer; }
    #menu input[type="range"] { flex: 1; }
    #menu button {
      background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 8px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit; text-align: left;
    }
    #menu button:hover { background: #353535; }
    #menu .menu-hint { color: #888; font-size: 11px; margin: 14px 0 0; }
    #menu .menu-version { color: #555; font-size: 10px; margin: 10px 0 0; text-align: right; }
    #menu .menu-skills { list-style: none; padding: 0; margin: 0 0 12px; min-width: 320px; }
    #menu .menu-skills li { padding: 8px 10px; margin: 6px 0; border-radius: 4px; background: #1f1f1f; border: 1px solid #2e2e2e; }
    #menu .menu-skills li.on  { background: #1d2a1d; border-color: #335433; }
    #menu .menu-skills li.off { opacity: 0.75; }
    #menu .menu-skill-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    #menu .menu-skill-desc { color: #aaa; font-size: 11px; margin-top: 2px; }
    #menu .menu-skill-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; letter-spacing: 1px; }
    #menu .menu-skill-tag.on  { background: #2a5a2a; color: #d8f5d8; }
    #menu .menu-skill-tag.off { background: #3a3a3a; color: #aaa; }
    #menu .menu-credits { font-size: 12px; line-height: 1.5; color: #ccc; margin: 0 0 10px; }
    #menu .menu-credits a { color: #9ab1ff; text-decoration: none; }
    #menu .menu-credits a:hover { text-decoration: underline; }
    #menu .inv-empty { color: #888; font-style: italic; margin: 0 0 12px; }
    #menu .inv-equipped { background: #1d2440; border: 1px solid #303a60; border-radius: 4px; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: #cfd6e8; }
    #menu .inv-equipped > div { display: flex; align-items: center; gap: 8px; margin: 2px 0; }
    #menu .inv-equipped .inv-label { color: #8090b0; min-width: 60px; }
    #menu .inv-equipped em { color: #777; font-style: italic; }
    #menu .inv-equipped-default { color: #7a8aa8; font-size: 10px; }
    #menu .inv-equipped button { background: #2a2a2a; color: #eee; border: 1px solid #444; padding: 2px 8px; border-radius: 3px; font-size: 10px; cursor: pointer; }
    #menu .inv-list { list-style: none; padding: 0; margin: 0; max-height: 280px; overflow-y: auto; min-width: 340px; }
    #menu .inv-list li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 4px 0; background: #1f1f1f; border: 1px solid #2e2e2e; border-radius: 3px; }
    #menu .inv-list .inv-name { flex: 1; font-size: 12px; }
    #menu .inv-list .inv-count { color: #aaa; font-size: 11px; min-width: 36px; text-align: right; }
    #menu .inv-list .inv-action { min-width: 70px; text-align: right; }
    #menu .inv-list .inv-action button { background: #2a2a2a; color: #eee; border: 1px solid #444; padding: 3px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; }
    #menu .inv-list .inv-action button:hover { background: #353535; }
    #menu .inv-equipped-tag { color: #b8c6ff; font-size: 10px; letter-spacing: 1px; }
    #menu .inv-player { margin: 8px 0 6px; font-size: 13px; color: #b8c6ff; letter-spacing: 1px; }
    #menu .inv-sep { border: none; border-top: 1px dashed #2e2e2e; margin: 14px 0; }
    #menu .menu-controls-list { list-style: none; padding: 0; margin: 0 0 12px; min-width: 360px; }
    #menu .menu-controls-list li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin: 4px 0; background: #1f1f1f; border: 1px solid #2e2e2e; border-radius: 3px; }
    #menu .menu-controls-label { flex: 1; font-size: 12px; color: #ccc; }
    #menu .menu-controls-key { min-width: 96px; text-align: center !important; font-family: monospace; font-size: 11px; padding: 4px 8px !important; }
    #menu .menu-controls-key.capturing { background: #3a3a55; border-color: #5a5a88; color: #fff; }
    #menu .menu-tabs { display: flex; gap: 6px; margin: 0 0 10px; }
    #menu .menu-tab { background: #1f1f1f; color: #aaa; border: 1px solid #333; padding: 6px 12px; border-radius: 4px; font-size: 12px; cursor: pointer; }
    #menu .menu-tab:hover { background: #2a2a2a; }
    #menu .menu-tab.active { background: #2a3a55; border-color: #4a5a88; color: #fff; }
  `;
  const style = document.createElement("style");
  style.id = "menu-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
