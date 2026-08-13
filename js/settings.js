// User-tweakable settings persisted to localStorage. Tiny: just a few
// knobs you'd want to flip without recompiling.

import { setMuted, setSfxVolume } from "./audio.js";
import { refreshMusicVolume } from "./music.js";
import { getNativeState } from "./nativeBridge.js";

const KEY = "sneakbit.settings.v1";

// Locales we ship a data/strings.<lang>.json for. "auto" resolves to the
// browser's preferred language at load time (see resolveLanguage).
export const SUPPORTED_LANGUAGES = ["en", "it"];

const DEFAULTS = {
  // The old (Rust) builds had no volume sliders at all — only on/off toggles —
  // so an update that migrates their settings has no level to port and lands
  // here (legacySave.js only patches a volume in to say "this channel was
  // off"). These are the levels a fresh install starts at too.
  sfxVolume: 0.65,
  musicVolume: 0.4,
  // UI / content language. "auto" follows navigator.language; otherwise one
  // of SUPPORTED_LANGUAGES. Changing it requires a reload (the string table
  // is fetched once at startup) — the settings panel handles that.
  language: "auto",
  // Start muted by default — see defaultMuted() for the desktop exception.
  // firstLaunch.js promotes this to a persisted `muted` on the very first
  // visit, but applyFirstLaunch runs *after* loadAudio / installMusic /
  // installToast — leaving a small window where any sound (a footstep from
  // an early input, a music track that auto-starts) would play unmuted on
  // mobile. Starting from `true` collapses that window. Returning visitors
  // keep whatever they set in the settings panel.
  muted: true,
  showFps: true,
  // Co-op friendly fire — off by default. When on, a bullet whose
  // playerIndex doesn't match the player it overlaps applies damage.
  friendlyFire: false,
  // Vibration, on by default. One knob for every motor: the phone buzzing
  // under the on-screen controls (haptics.js) and the controller rumbling
  // on damage (rumble.js). A player who turns vibration off means all of it.
  haptics: true,
  // On-screen mobile movement input: "buttons" (the 4-way d-pad) or
  // "joystick" (the floating analog stick ported from the original).
  // Touch-only; ignored on desktop. Joystick by default — it matches the
  // feel of the original game and reads as a single, discoverable control.
  // Only affects fresh installs; returning players keep their saved choice.
  touchControls: "joystick",
};

// Whether a fresh install should start muted. The desktop shell is the one
// place it shouldn't: Steam launched the app deliberately, it owns its own
// window rather than sharing a tab with whatever else the player has open,
// and Electron's autoplay policy never blocks a sound — so a silent launch
// reads as a broken game. A browser tab and both mobile shells still start
// quiet. Only affects first launch; a saved `muted` always wins.
//
// Safe to call at loadSettings() time: main.js awaits initNativeBridge()
// before it, so the platform is already known.
export function defaultMuted() {
  return getNativeState()?.platform !== "electron";
}

let current = { ...DEFAULTS };
let firstLaunch = false;

export function loadSettings() {
  const defaults = { ...DEFAULTS, muted: defaultMuted() };
  current = { ...defaults };
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch {}
  if (raw) {
    try { current = { ...defaults, ...JSON.parse(raw) }; } catch {}
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
