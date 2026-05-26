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

let root = null;
let open = false;
let screen = "pause"; // "pause" | "settings"

export function installMenu() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "menu";
  root.innerHTML = `
    <div class="menu-card" data-screen="pause">
      <h1>SneakBit</h1>
      <div class="menu-row menu-controls menu-stack">
        <button id="menu-resume">Resume (Esc)</button>
        <button id="menu-open-settings">Settings</button>
        <button id="menu-new-game">New game (wipe save)</button>
        <button id="menu-clear-cache">Clear cache &amp; reload</button>
      </div>
      <p class="menu-hint">
        WASD / arrows to move &middot; E or Enter to interact<br>
        F to throw a kunai &middot; Esc to toggle menu
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
      <div class="menu-row menu-controls">
        <button id="menu-settings-back">Back</button>
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

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" && e.code !== "KeyM") return;
    e.preventDefault();
    if (!open) { openMenu(); return; }
    if (screen === "settings") { showScreen("pause"); return; }
    closeMenu();
  });
  return root;
}

export function isMenuOpen() { return open; }

function openMenu() {
  open = true;
  showScreen("pause");
  root.style.display = "flex";
  playSfx("hintReceived", { volume: 0.5 });
}

function closeMenu() {
  open = false;
  root.style.display = "none";
  playSfx("hintReceived", { volume: 0.5 });
}

function showScreen(next) {
  screen = next;
  root.querySelectorAll(".menu-card").forEach(card => {
    card.style.display = card.dataset.screen === next ? "block" : "none";
  });
  if (next === "settings") syncSettingsWidgets();
}

function bindWidgets() {
  root.querySelector("#menu-resume").addEventListener("click", closeMenu);
  root.querySelector("#menu-open-settings").addEventListener("click", () => showScreen("settings"));
  root.querySelector("#menu-settings-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-new-game").addEventListener("click", () => {
    if (!confirm("Wipe save and start over? Inventory, dialogue progress and unlocked skills will be reset.")) return;
    try { localStorage.clear(); } catch {}
    clearProgress();
    location.reload();
  });
  root.querySelector("#menu-clear-cache").addEventListener("click", () => {
    try { localStorage.clear(); } catch {}
    location.reload();
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
  `;
  const style = document.createElement("style");
  style.id = "menu-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
