// User-tweakable settings persisted to localStorage. Tiny: just a few
// knobs you'd want to flip without recompiling.

import { setMuted, setSfxVolume } from "./audio.js";
import { refreshMusicVolume } from "./music.js";

const KEY = "sneakbit.settings.v1";

const DEFAULTS = {
  sfxVolume: 0.6,
  musicVolume: 0.45,
  // Start muted by default. firstLaunch.js promotes this to a persisted
  // `muted: true` on the very first visit, but applyFirstLaunch runs
  // *after* loadAudio / installMusic / installToast — leaving a small
  // window where any sound (a footstep from an early input, a music
  // track that auto-starts) would play unmuted on mobile. Starting from
  // `true` collapses that window. Returning visitors keep whatever
  // they set in the settings panel.
  muted: true,
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
