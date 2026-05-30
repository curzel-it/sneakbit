// User-tweakable settings persisted to localStorage. Tiny: just a few
// knobs you'd want to flip without recompiling.

import { setMuted, setSfxVolume } from "./audio.js?v=20260530c";
import { refreshMusicVolume } from "./music.js?v=20260530c";

const KEY = "sneakbit.settings.v1";

// Locales we ship a data/strings.<lang>.json for. "auto" resolves to the
// browser's preferred language at load time (see resolveLanguage).
export const SUPPORTED_LANGUAGES = ["en", "it"];

const DEFAULTS = {
  sfxVolume: 0.6,
  musicVolume: 0.45,
  // UI / content language. "auto" follows navigator.language; otherwise one
  // of SUPPORTED_LANGUAGES. Changing it requires a reload (the string table
  // is fetched once at startup) — the settings panel handles that.
  language: "auto",
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

// The two-letter locale to actually load strings for. Resolves the "auto"
// setting against the browser's preferred languages, falling back to English
// for anything we don't ship a table for.
export function resolveLanguage() {
  const pref = current.language ?? "auto";
  if (pref !== "auto" && SUPPORTED_LANGUAGES.includes(pref)) return pref;
  const candidates = (typeof navigator !== "undefined" && navigator.languages?.length)
    ? navigator.languages
    : [(typeof navigator !== "undefined" && navigator.language) || "en"];
  for (const tag of candidates) {
    const code = String(tag).toLowerCase().split("-")[0];
    if (SUPPORTED_LANGUAGES.includes(code)) return code;
  }
  return "en";
}

function applyToRuntime() {
  setSfxVolume(current.sfxVolume);
  setMuted(current.muted);
  refreshMusicVolume();
}
