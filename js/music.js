// Background music. Tracks live in assets/audio/<name>.mp3 — zone JSON
// names the track without extension. Cross-fades on track change and
// loops indefinitely.
//
// First playback waits for a user gesture (keypress / click) to satisfy
// browser autoplay rules; we listen once and start whatever's queued. The
// desktop app is exempt — see installMusic.

import { getSettings } from "./settings.js";
import { getNativeState } from "./nativeBridge.js";

const cache = new Map();
let current = null;       // { name, audio }
let pending = null;       // name queued before first gesture
let gestureReady = false;
const FADE_MS = 600;

export function installMusic() {
  // Electron runs with `no-user-gesture-required`, and the desktop app starts
  // unmuted (settings.js defaultMuted), so the opening track can play the
  // moment the zone loads — a Steam game that stays silent until you happen to
  // press a key reads as broken. The listeners below stay wired anyway: if a
  // play() is refused after all, playTrack hands the track back to them.
  if (getNativeState()?.platform === "electron") gestureReady = true;

  const start = () => {
    if (gestureReady) return;
    gestureReady = true;
    if (pending) {
      const name = pending; pending = null;
      playTrack(name);
    }
    window.removeEventListener("keydown", start, true);
    window.removeEventListener("pointerdown", start, true);
  };
  window.addEventListener("keydown", start, true);
  window.addEventListener("pointerdown", start, true);
}

export function playTrack(name) {
  if (!name) return stopTrack();
  if (current && current.name === name) return;
  if (!gestureReady) { pending = name; return; }

  const next = ensure(name);
  next.loop = true;
  const target = musicVolume();
  // Belt-and-suspenders mute: setting `.muted = true` in addition to
  // `volume = 0` hard-mutes the element. On iOS Safari calling `.play()`
  // on a track whose `.muted` is false can leak a brief blip during the
  // volume ramp even when we set volume to 0 first — happens on the very
  // first track of a first-launch mobile visit. Hard-mute prevents it.
  next.muted = target === 0;
  next.volume = 0;
  next.play().catch(() => requeueForGesture(name, next));
  fadeTo(next, target, FADE_MS);

  if (current) {
    const prev = current.audio;
    fadeTo(prev, 0, FADE_MS, () => { try { prev.pause(); } catch {} });
  }
  current = { name, audio: next };
}

export function stopTrack() {
  if (!current) return;
  const audio = current.audio;
  fadeTo(audio, 0, FADE_MS, () => { try { audio.pause(); } catch {} });
  current = null;
}

// A refused play() would otherwise leave `current` pointing at a track nobody
// is playing, so nothing ever starts it again. Put it back in the queue and
// re-arm the gesture path instead. Only reachable when a shell's autoplay
// policy is stricter than installMusic assumed.
function requeueForGesture(name, audio) {
  if (current?.audio !== audio) return;
  current = null;
  pending = name;
  gestureReady = false;
}

export function refreshMusicVolume() {
  if (!current) return;
  const v = musicVolume();
  current.audio.muted = v === 0;
  current.audio.volume = v;
}

function musicVolume() {
  const s = getSettings();
  if (s.muted) return 0;
  return clamp(s.musicVolume ?? 0.4, 0, 1);
}

function ensure(name) {
  let a = cache.get(name);
  if (!a) {
    const fileName = name.endsWith(".mp3") ? name : `${name}.mp3`;
    a = new Audio(`./assets/audio/${fileName}`);
    a.preload = "auto";
    cache.set(name, a);
  }
  return a;
}

function fadeTo(audio, target, ms, done) {
  const from = audio.volume;
  const start = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / ms);
    audio.volume = clamp(from + (target - from) * t, 0, 1);
    if (t < 1) requestAnimationFrame(step);
    else if (done) done();
  };
  requestAnimationFrame(step);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
