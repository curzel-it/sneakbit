// User-tweakable settings persisted to localStorage. Tiny: just a few
// knobs you'd want to flip without recompiling.

import { setMuted, setSfxVolume } from "./audio.js";
import { refreshMusicVolume } from "./music.js";

const KEY = "sneakbit.settings.v1";

const DEFAULTS = {
  sfxVolume: 0.6,
  musicVolume: 0.45,
  muted: false,
  showFps: true,
  // Co-op friendly fire — off by default. When on, a bullet whose
  // playerIndex doesn't match the player it overlaps applies damage.
  friendlyFire: false,
};

let current = { ...DEFAULTS };
let firstLaunch = false;

export function loadSettings() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch {}
  if (raw) {
    try { current = { ...DEFAULTS, ...JSON.parse(raw) }; } catch {}
  } else {
    firstLaunch = true;
  }
  applyToRuntime();
  return current;
}

export function isFirstLaunch() { return firstLaunch; }

export function saveSettings(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  applyToRuntime();
  return current;
}

export function getSettings() { return current; }

function applyToRuntime() {
  setSfxVolume(current.sfxVolume);
  setMuted(current.muted);
  refreshMusicVolume();
}
