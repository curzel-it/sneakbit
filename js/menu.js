// HTML pause/settings menu. Esc toggles. Lives outside the canvas so we
// can style it with CSS and bind real form widgets.

import { getSettings, saveSettings } from "./settings.js";
import { playSfx } from "./audio.js";

let root = null;
let open = false;
let toggleListener = null;

export function installMenu() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "menu";
  root.innerHTML = `
    <div class="menu-card">
      <h1>SneakBit</h1>
      <div class="menu-row">
        <label for="opt-volume">Volume</label>
        <input id="opt-volume" type="range" min="0" max="100" step="1" />
        <span id="opt-volume-val"></span>
      </div>
      <div class="menu-row">
        <label for="opt-muted"><input id="opt-muted" type="checkbox" /> Mute</label>
      </div>
      <div class="menu-row">
        <label for="opt-fps"><input id="opt-fps" type="checkbox" /> Show FPS</label>
      </div>
      <div class="menu-row menu-controls">
        <button id="opt-close">Close (Esc)</button>
        <button id="opt-clear-cache">Clear cache &amp; reload</button>
      </div>
      <p class="menu-hint">
        WASD / arrows to move &middot; E or Enter to interact<br>
        Esc to toggle menu &middot; Space to advance dialogue
      </p>
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

  toggleListener = (e) => {
    if (e.code === "Escape" || e.code === "KeyM") {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener("keydown", toggleListener);
  return root;
}

export function isMenuOpen() { return open; }

export function toggle() {
  open = !open;
  root.style.display = open ? "flex" : "none";
  if (open) syncWidgetsFromSettings();
  playSfx("neutral", { volume: 0.5 });
}

function bindWidgets() {
  const volume = root.querySelector("#opt-volume");
  const volumeVal = root.querySelector("#opt-volume-val");
  const muted = root.querySelector("#opt-muted");
  const fps = root.querySelector("#opt-fps");
  const close = root.querySelector("#opt-close");

  volume.addEventListener("input", () => {
    const v = parseInt(volume.value, 10) / 100;
    saveSettings({ volume: v });
    volumeVal.textContent = `${volume.value}%`;
  });
  muted.addEventListener("change", () => {
    saveSettings({ muted: muted.checked });
  });
  fps.addEventListener("change", () => {
    saveSettings({ showFps: fps.checked });
  });
  close.addEventListener("click", () => toggle());
  root.querySelector("#opt-clear-cache").addEventListener("click", () => {
    try { localStorage.clear(); } catch {}
    location.reload();
  });
}

function syncWidgetsFromSettings() {
  const s = getSettings();
  root.querySelector("#opt-volume").value = String(Math.round(s.volume * 100));
  root.querySelector("#opt-volume-val").textContent = `${Math.round(s.volume * 100)}%`;
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
    #menu label { color: #ddd; cursor: pointer; }
    #menu input[type="range"] { flex: 1; }
    #menu button {
      background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 6px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit;
    }
    #menu button:hover { background: #353535; }
    #menu .menu-hint { color: #888; font-size: 11px; margin: 14px 0 0; }
  `;
  const style = document.createElement("style");
  style.id = "menu-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
