// User-tweakable settings persisted to localStorage. Tiny: just a few
// knobs you'd want to flip without recompiling.

import { setMuted, setVolume, getVolume, isMuted } from "./audio.js";

const KEY = "sneakbit.settings.v1";

const DEFAULTS = {
  volume: 0.6,
  muted: false,
  showFps: true,
};

let current = { ...DEFAULTS };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) current = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  applyToRuntime();
  return current;
}

export function saveSettings(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  applyToRuntime();
  return current;
}

export function getSettings() { return current; }

function applyToRuntime() {
  setVolume(current.volume);
  setMuted(current.muted);
}

export function syncFromRuntime() {
  // In case other code mutated audio directly (debug, etc.).
  current.volume = getVolume();
  current.muted = isMuted();
}
