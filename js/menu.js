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
import { getSkills } from "./skills.js";

let root = null;
let open = false;
let screen = "pause"; // "pause" | "settings" | "skills" | "credits"

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
        <button id="menu-open-skills">Skills</button>
        <button id="menu-export-save">Export save (copy JSON)</button>
        <button id="menu-import-save">Import save (paste JSON)</button>
        <button id="menu-open-credits">Credits</button>
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
    <div class="menu-card" data-screen="credits">
      <h1>Credits</h1>
      <p class="menu-credits">
        <strong>SneakBit</strong> · web port<br>
        Original game by <a href="https://github.com/curzel-it/sneakbit" target="_blank" rel="noopener">curzel-it</a><br>
        Shipped on Steam, iOS, and Android.
      </p>
      <p class="menu-credits">
        HTML5/Canvas port maintained by Federico Curzel.<br>
        Source: <a href="https://github.com/curzel-it/sneakbit-html" target="_blank" rel="noopener">github.com/curzel-it/sneakbit-html</a>
      </p>
      <p class="menu-hint">
        Tile + sprite art and audio are from the original Rust build.
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

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" && e.code !== "KeyM") return;
    e.preventDefault();
    if (!open) { openMenu(); return; }
    if (screen !== "pause") { showScreen("pause"); return; }
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
  if (next === "skills") syncSkillsWidgets();
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
  root.querySelector("#menu-open-settings").addEventListener("click", () => showScreen("settings"));
  root.querySelector("#menu-open-skills").addEventListener("click", () => showScreen("skills"));
  root.querySelector("#menu-open-credits").addEventListener("click", () => showScreen("credits"));
  root.querySelector("#menu-settings-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-skills-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-credits-back").addEventListener("click", () => showScreen("pause"));
  root.querySelector("#menu-export-save").addEventListener("click", exportSave);
  root.querySelector("#menu-import-save").addEventListener("click", importSave);
  root.querySelector("#menu-new-game").addEventListener("click", () => {
    if (!confirm("Wipe save and start over? Inventory, dialogue progress and unlocked skills will be reset.")) return;
    try { localStorage.clear(); } catch {}
    clearProgress();
    // A `?world=X` query overrides saved progress in main.js. After wiping
    // the save we also need to drop the URL override or the player would
    // reload back into the same world at the same tile.
    location.replace(location.pathname);
  });
  root.querySelector("#menu-clear-cache").addEventListener("click", () => {
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
  `;
  const style = document.createElement("style");
  style.id = "menu-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
