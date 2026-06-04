// HTML pause/settings overlay. Esc toggles. Lives outside the canvas so we
// can style it with CSS and bind real form widgets.
//
// One overlay, two screens: a short pause menu that links to a settings
// screen. isMenuOpen() reports either screen as "open" so the game stays
// paused while the player tweaks audio.

import { getSettings, saveSettings } from "./settings.js";
import { playSfx } from "./audio.js";
import { APP_VERSION } from "./constants.js";
import { clearProgress } from "./save.js";
import { renderInventoryInto } from "./inventoryScreen.js";
import { isCreativeMode } from "./creativeMode.js";
import { matchesAction } from "./keyBindings.js";
import { glyphForAction } from "./inputGlyphs.js";
import { initKeyBindingsScreen, renderControlsList, resetCaptures, consumeMenuKeydown } from "./keyBindingsScreen.js";
import { getActiveInputDevice, onActiveInputDeviceChange } from "./activeInputDevice.js";
import { registerMenuSurface, focusFirstIn } from "./menuNav.js";
import { isCoopActive } from "./coopMode.js";
import { exportSave, importSave } from "./saveBackup.js";
import { initCreativeZoneTools, saveZoneNow, exportZone, resetZone } from "./creativeZoneTools.js";
import { openPartyPanel, isPartyPanelOpen } from "./partyPanel.js";
import { openAccountPanel, isAccountPanelOpen } from "./accountPanel.js";
import { onAccountChange, getUser, getToken, isSignedIn } from "./accountSession.js";
import { markDirty as markCloudSaveDirty } from "./cloudSave.js";
import { deleteCloudSave } from "./saveApi.js";
import { isGameOverOpen } from "./gameOver.js";
import { isFastTravelOpen } from "./fastTravel.js";
import { isMessageOpen } from "./message.js";
import { isDialogueOpen } from "./dialogue.js";
import { getRuntimeRole, onRoleChange } from "./onlineMode.js";
import { isFullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from "./fullscreen.js";
import { setTouchControlStyle } from "./touch.js";
import { el } from "./dom.js";

// Modals that own the keyboard while they're up. If any is open we treat
// Esc / the menu key as "dismiss the active modal" — owned by that modal's
// own listener — and don't pop the pause menu on top of it.
function isAnotherModalOpen() {
  return isGameOverOpen()
    || isFastTravelOpen()
    || isMessageOpen()
    || isDialogueOpen()
    || isPartyPanelOpen()
    || isAccountPanelOpen();
}

let root = null;
let open = false;
let screen = "pause"; // "pause" | "settings" | "credits" | "inventory" | "controls" | "creative"

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
  root = el("div", {
    id: "menu",
    html: `
    <div class="menu-card" data-screen="pause">
      <img class="menu-logo" src="assets/logo.png?v=20260531c" alt="SneakBit" />
      <div class="menu-row menu-controls menu-stack">
        <button id="menu-resume">Resume (Esc)</button>
        <button id="menu-open-multiplayer">Multiplayer</button>
        <button id="menu-open-account">Account</button>
        <button id="menu-open-inventory">Inventory &amp; Equipment</button>
        <button id="menu-open-settings">Settings</button>
        <button id="menu-open-creative" data-creative-only>Creative tools…</button>
        <button id="menu-open-credits">Credits</button>
        <button id="menu-new-game" data-guest-hidden>New game (wipe save)</button>
      </div>
      <p class="menu-hint" id="menu-pause-hint"></p>
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
      <div class="menu-row" id="opt-touch-controls-row">
        <label for="opt-touch-controls">Touch controls</label>
        <select id="opt-touch-controls">
          <option value="buttons">Buttons</option>
          <option value="joystick">Joystick</option>
        </select>
      </div>
      <div class="menu-row">
        <label for="opt-language">Language / Lingua</label>
        <select id="opt-language">
          <option value="auto">Auto</option>
          <option value="en">English</option>
          <option value="it">Italiano</option>
        </select>
      </div>
      <div class="menu-row" id="opt-friendly-fire-row">
        <label for="opt-friendly-fire"><input id="opt-friendly-fire" type="checkbox" /> Friendly fire (co-op)</label>
      </div>
      <div class="menu-row menu-controls menu-stack">
        <button id="menu-open-controls">Key bindings…</button>
        <button id="menu-fullscreen">Fullscreen</button>
        <button id="menu-clear-cache" data-guest-hidden>Clear cache &amp; reload</button>
      </div>
      <div class="menu-row menu-controls">
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
        <button class="menu-tab" data-player="2">Player 3</button>
        <button class="menu-tab" data-player="3">Player 4</button>
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
        <a href="https://github.com/curzel-it/sneakbit/tree/rust-core-tip" target="_blank" rel="noopener">original Rust build</a>.
      </p>
      <p class="menu-credits">
        Source:
        <a href="https://github.com/curzel-it/sneakbit" target="_blank" rel="noopener">github.com/curzel-it/sneakbit</a>
      </p>
      <p class="menu-credits">
        Music by <a href="https://www.filippovicarelli.com/8bit-game-background-music" target="_blank" rel="noopener">Filippo Vicarelli</a><br>
        Sound effects by <a href="https://opengameart.org/content/512-sound-effects-8-bit-style" target="_blank" rel="noopener">SubspaceAudio</a><br>
        Font by <a href="https://dl.dafont.com/dl/?f=pixel_operator" target="_blank" rel="noopener">HarvettFox96</a>
      </p>
      <p class="menu-credits">
        <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a> &middot;
        <a href="terms.html" target="_blank" rel="noopener">Terms &amp; Conditions</a>
      </p>
      <div class="menu-row menu-controls">
        <button id="menu-credits-back">Back</button>
      </div>
    </div>
    <div class="menu-card" data-screen="creative">
      <h1>Creative tools</h1>
      <div class="menu-row menu-controls menu-stack">
        <button id="menu-export-save" data-creative-only>Export save (copy JSON)</button>
        <button id="menu-import-save" data-creative-only>Import save (paste JSON)</button>
        <button id="menu-save-zone" data-creative-only data-desktop-only data-editor-only>Save zone (flush to server)</button>
        <button id="menu-export-zone" data-creative-only data-desktop-only>Export zone JSON…</button>
        <button id="menu-reset-zone" data-creative-only data-desktop-only data-editor-only>Reset zone (revert to shipped)</button>
        <button id="menu-open-map-editor" data-creative-only data-desktop-only data-editor-only>Map editor…</button>
      </div>
      <div class="menu-row menu-controls">
        <button id="menu-creative-back">Back</button>
      </div>
    </div>
  `,
    style: {
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
    },
  });
  document.body.appendChild(root);
  injectStyles();
  bindWidgets();
  initKeyBindingsScreen(root);
  initCreativeZoneTools(() => getState());
  applyCreativeModeVisibility();
  applyRoleVisibility();
  // Keep the role gates live across role transitions — if the menu is
  // already open when the user joins a session, the buttons should
  // disappear without waiting for a close/reopen.
  onRoleChange(() => { if (root) applyRoleVisibility(); });
  // Keep the pause hint's glyphs in sync if the player switches device
  // while the menu is open.
  onActiveInputDeviceChange(() => { if (open) renderPauseHint(); });
  // Roving focus / controller navigation: the active card is whichever
  // screen is showing.
  registerMenuSurface({ root: activeCard, isOpen: () => open });

  window.addEventListener("keydown", (e) => {
    // The Key Bindings screen owns the keyboard while it's capturing a
    // rebind — let it consume the keystroke (and handle its own Esc)
    // rather than treating it as a menu toggle.
    if (consumeMenuKeydown(e)) return;
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
  const editor = !!getUser()?.editor;
  // Three attributes, ANDed: a [data-creative-only] entry hides outside
  // creative; [data-desktop-only] additionally hides on coarse-pointer
  // devices where the click-and-drag editor + Save/Export wouldn't be
  // usable; [data-editor-only] additionally hides for non-editor accounts
  // (the server enforces this too — a non-editor PUT gets 403). The
  // server-backed zone tools (Save/Reset/Map editor) carry all three.
  root.querySelectorAll("[data-creative-only]").forEach((node) => {
    const requiresDesktop = node.hasAttribute("data-desktop-only");
    const requiresEditor = node.hasAttribute("data-editor-only");
    const show = creative
      && (!requiresDesktop || desktop)
      && (!requiresEditor || editor);
    node.style.display = show ? "" : "none";
  });
}

// "New Game" and "Clear cache" both wipe localStorage, which includes
// the online UUID this tab uses as its stable identity. A guest doing
// that mid-session would lose their seat (the server would treat the
// next reconnect as a fresh peer). So we hide both buttons whenever
// runtime role is guest, and re-show on every other role transition.
function applyRoleVisibility() {
  const isGuest = getRuntimeRole() === "guest";
  root.querySelectorAll("[data-guest-hidden]").forEach((node) => {
    node.style.display = isGuest ? "none" : "";
  });
}

// The currently visible menu card — the root menuNav focuses within.
function activeCard() {
  return root?.querySelector(`.menu-card[data-screen="${screen}"]`);
}

function openMenu() {
  open = true;
  // Show + apply role gating before focusing so the first highlight lands
  // on a genuinely visible item.
  root.style.display = "flex";
  applyRoleVisibility();
  showScreen("pause");
  renderPauseHint();
  playSfx("hintReceived", { volume: 0.5 });
}

// The pause-screen control hint, in the active device's glyphs. Keyboard
// shows the player's bound keys; a pad shows A/B/X/Start.
function renderPauseHint() {
  const node = root?.querySelector("#menu-pause-hint");
  if (!node) return;
  const move = getActiveInputDevice() === "gamepad" ? "Stick / D-pad" : "WASD / arrows";
  node.innerHTML =
    `${move} to move &middot; ${glyphForAction("interact")} to interact<br>` +
    `${glyphForAction("shoot")} to throw a kunai &middot; ${glyphForAction("melee")} to melee ` +
    `&middot; ${glyphForAction("menu")} to toggle menu`;
}

function closeMenu() {
  open = false;
  resetCaptures();
  root.style.display = "none";
  playSfx("hintReceived", { volume: 0.5 });
}

function showScreen(next) {
  screen = next;
  root.querySelectorAll(".menu-card").forEach(card => {
    card.style.display = card.dataset.screen === next ? "block" : "none";
  });
  if (next === "settings") syncSettingsWidgets();
  if (next === "inventory") renderInventoryInto(root.querySelector("#menu-inventory-body"));
  if (next === "controls") renderControlsList();
  if (next !== "controls") resetCaptures();
  // Highlight the first item of the now-visible screen for keyboard /
  // controller navigation.
  if (open) focusFirstIn(activeCard);
}

function bindWidgets() {
  root.querySelector("#menu-resume").addEventListener("click", closeMenu);
  root.querySelector("#menu-open-multiplayer").addEventListener("click", () => {
    closeMenu();
    openPartyPanel();
  });
  const accountBtn = root.querySelector("#menu-open-account");
  accountBtn.addEventListener("click", () => {
    closeMenu();
    openAccountPanel();
  });
  // Reflect sign-in state in the row label ("Account" → the signed-in
  // display name / email). Fires immediately with the current user.
  const syncAccountLabel = (user) => {
    accountBtn.textContent = user ? `Account · ${user.displayName || user.email}` : "Account";
  };
  onAccountChange((user) => {
    syncAccountLabel(user);
    // The editor-only zone tools depend on user.editor — re-sync visibility
    // so they appear/disappear on sign-in/out without reopening the menu.
    applyCreativeModeVisibility();
  });
  syncAccountLabel(getUser());
  root.querySelector("#menu-open-settings").addEventListener("click", () => showScreen("settings"));
  const fullscreenBtn = root.querySelector("#menu-fullscreen");
  if (!isFullscreenSupported()) {
    // No element fullscreen here (e.g. iOS Safari) — don't show a dead button.
    fullscreenBtn.style.display = "none";
  } else {
    fullscreenBtn.addEventListener("click", () => toggleFullscreen());
    // Keep the label honest whether the player toggles from the menu, a
    // keyboard shortcut (F11), or the browser chrome.
    onFullscreenChange(syncFullscreenLabel);
    syncFullscreenLabel();
  }
  root.querySelector("#menu-open-credits").addEventListener("click", () => showScreen("credits"));
  root.querySelector("#menu-open-creative").addEventListener("click", () => showScreen("creative"));
  root.querySelector("#menu-open-inventory").addEventListener("click", () => showScreen("inventory"));
  root.querySelector("#menu-settings-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-open-controls").addEventListener("click", () => showScreen("controls"));
  root.querySelector("#menu-controls-back").addEventListener("click", () => showScreen("settings"));
  // The Key Bindings screen's own controls (device/player tabs, reset) are
  // wired by initKeyBindingsScreen().
  root.querySelector("#menu-credits-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-inventory-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-creative-back").addEventListener("click", () => showScreen("pause"));
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
    // A fresh start should be truly fresh: when signed in, delete the cloud
    // save too (keepalive so it survives the imminent reload), otherwise it
    // would just sync back down on the next sign-in. Best-effort — a failed
    // delete never blocks the local wipe.
    if (isSignedIn()) { try { deleteCloudSave(getToken(), { keepalive: true }); } catch {} }
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

  const touchControls = root.querySelector("#opt-touch-controls");
  touchControls.addEventListener("change", () => {
    saveSettings({ touchControls: touchControls.value });
    setTouchControlStyle(touchControls.value);
  });

  // The string table is fetched once at startup, so a language change only
  // takes effect after a reload. Persist the choice, then reload — mirroring
  // the "Clear cache & reload" flow so we don't re-save stale state on the
  // way out.
  const language = root.querySelector("#opt-language");
  language.addEventListener("change", () => {
    saveSettings({ language: language.value });
    // Language is account-scoped — flag the change so cloudSave pushes the
    // new value (the timestamp bump survives the reload below).
    try { markCloudSaveDirty(); } catch {}
    try { window.save?.suppressUnloadSave?.(); } catch {}
    location.reload();
  });
}

function syncFullscreenLabel() {
  const btn = root?.querySelector("#menu-fullscreen");
  if (btn) btn.textContent = isFullscreen() ? "Exit fullscreen" : "Fullscreen";
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
  root.querySelector("#opt-touch-controls").value = s.touchControls === "joystick" ? "joystick" : "buttons";
  root.querySelector("#opt-language").value = s.language ?? "auto";
  // Touch-control style only matters on a touch device — hide the row on
  // desktop, but keep it visible when `?touch=1` forces the overlay on so
  // the choice can be tuned with a mouse.
  const tcRow = root.querySelector("#opt-touch-controls-row");
  if (tcRow) {
    let forced = false;
    try { forced = new URLSearchParams(location.search).has("touch"); } catch { /* ignore */ }
    tcRow.style.display = (!isDesktop() || forced) ? "" : "none";
  }
  // Friendly fire is meaningless without a second hero in the world —
  // hide the row entirely unless local co-op is on or a network guest
  // is connected. `isCoopActive()` covers both.
  const ffRow = root.querySelector("#opt-friendly-fire-row");
  if (ffRow) ffRow.style.display = isCoopActive() ? "" : "none";
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
    #menu .menu-logo {
      display: block;
      width: min(280px, 60vw);
      height: auto;
      margin: 0 auto 18px;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    #menu .menu-row { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
    #menu .menu-stack { flex-direction: column; align-items: stretch; gap: 8px; }
    #menu label { color: #ddd; cursor: pointer; }
    #menu select {
      background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 6px 10px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    #menu input[type="range"] { flex: 1; }
    #menu button {
      background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 8px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit; text-align: left;
    }
    #menu button:hover { background: #353535; }
    #menu .menu-hint { color: #888; font-size: 11px; margin: 14px 0 0; }
    #menu .menu-version { color: #555; font-size: 10px; margin: 10px 0 0; text-align: right; }
    #menu .inv-skill-list { list-style: none; padding: 0; margin: 4px 0 0 28px; }
    #menu .inv-skill { padding: 5px 9px; margin: 4px 0; border-radius: 3px; background: #191919; border: 1px solid #2a2a2a; border-left-width: 2px; }
    #menu .inv-skill.is-unlocked { border-left-color: #335433; }
    #menu .inv-skill.is-locked { border-left-color: #3a3a3a; opacity: 0.7; }
    #menu .inv-skill-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
    #menu .inv-skill-name { color: #ddd; }
    #menu .inv-skill-desc { display: block; color: #999; font-size: 10px; margin-top: 2px; }
    #menu .inv-skill-tag { font-size: 9px; padding: 1px 6px; border-radius: 3px; letter-spacing: 1px; }
    #menu .inv-skill-tag.is-unlocked { background: #2a5a2a; color: #d8f5d8; }
    #menu .inv-skill-tag.is-locked { background: #3a3a3a; color: #aaa; }
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
    #menu .inv-slot { margin-bottom: 12px; min-width: 340px; }
    #menu .inv-slot-title { margin: 0 0 6px; font-size: 12px; color: #8090b0; letter-spacing: 1px; text-transform: uppercase; }
    #menu .inv-slot-list { list-style: none; padding: 0; margin: 0; }
    #menu .inv-slot-list li { margin: 4px 0; }
    #menu .inv-slot-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 7px 10px; background: #1f1f1f; border: 1px solid #2e2e2e; border-radius: 3px; color: #eee; font: inherit; font-size: 12px; cursor: pointer; }
    #menu .inv-slot-row:hover { background: #292929; }
    #menu .inv-slot-row.is-active { background: #1d2440; border-color: #3a4a80; }
    #menu .inv-slot-row .inv-radio { color: #6678b0; }
    #menu .inv-slot-row.is-active .inv-radio { color: #b8c6ff; }
    #menu .inv-slot-row .inv-name { flex: 1; }
    #menu .inv-slot-row .inv-count { color: #aaa; font-size: 11px; min-width: 36px; text-align: right; }
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
