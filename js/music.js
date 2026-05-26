// Background music. Tracks live in assets/audio/<name>.mp3 — zone JSON
// names the track without extension. Cross-fades on track change and
// loops indefinitely.
//
// First playback waits for a user gesture (keypress / click) to satisfy
// browser autoplay rules; we listen once and start whatever's queued.

import { getSettings } from "./settings.js";

const cache = new Map();
let current = null;       // { name, audio }
let pending = null;       // name queued before first gesture
let gestureReady = false;
const FADE_MS = 600;

export function installMusic() {
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
  next.volume = 0;
  next.play().catch(() => {});
  fadeTo(next, musicVolume(), FADE_MS);

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

export function refreshMusicVolume() {
  if (!current) return;
  current.audio.volume = musicVolume();
}

function musicVolume() {
  const s = getSettings();
  if (s.muted) return 0;
  return clamp(s.musicVolume ?? 0.45, 0, 1);
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
