// Short SFX through WebAudio: each clip is decoded once into an AudioBuffer
// and played through a throwaway AudioBufferSourceNode. Mirrors the original
// game's SoundEffect ↔ file mapping (game/src/features/audio.rs); call sites
// pass the same semantic names (e.g. "stepTaken", "knifeThrown") rather than
// file ids.
//
// This used to clone an HTMLAudioElement per play. That's fine on desktop but
// ruinous on iOS, where every media element is backed by its own AVFoundation
// pipeline: swinging at a room full of barrels fires 10+ sounds a second
// (swings, deaths, pickups, footsteps), each one a fresh pipeline that nothing
// ever tore down, and the WebView falls off a cliff while the host app's CPU
// and memory gauges — which measure a different process — stay flat.
// AudioBufferSourceNodes are the API's disposable unit: cheap to make, they
// release on ended, and they mix without an instance ceiling.
//
// The first-gesture handshake is why HTMLAudioElement was picked originally.
// It costs one listener (same idiom as music.js): the context is created
// suspended and resumed on the first keypress / pointerdown.
//
// Music stays on HTMLAudioElement (music.js) — that's a single streaming
// element, which is exactly what media elements are good at.

const SOURCES = {
  stepTaken:         "./assets/audio/sfx_movement_footsteps1a.mp3",
  zoneChange:       "./assets/audio/sfx_movement_dooropen1.mp3",
  ammoCollected:     "./assets/audio/sfx_sounds_interaction22.mp3",
  keyCollected:      "./assets/audio/sfx_sounds_fanfare3.mp3",
  hintReceived:      "./assets/audio/sfx_sound_neutral5.mp3",
  playerResurrected: "./assets/audio/sfx_sounds_powerup1.mp3",
  knifeThrown:       "./assets/audio/sfx_movement_jump12_landing.mp3",
  bulletBounced:     "./assets/audio/sfx_movement_jump20.mp3",
  gameOver:          "./assets/audio/sfx_sounds_negative1.mp3",
  noAmmo:            "./assets/audio/sfx_wpn_noammo3.mp3",
  swordSlash:        "./assets/audio/sfx_wpn_sword2.mp3",
  gunShot:           "./assets/audio/sfx_wpn_machinegun_loop1.mp3",
  loudGunShot:       "./assets/audio/sfx_weapon_shotgun3.mp3",
  smallExplosion:    "./assets/audio/sfx_exp_short_hard8.mp3",
  deathMonster:      "./assets/audio/sfx_deathscream_human11.mp3",
  deathNonMonster:   "./assets/audio/sfx_deathscream_android7.mp3",
};

// Per-sound default volume, matching volume_for_sound_effect in the original.
const VOLUMES = {
  // Except footsteps: the original desktop build played these at 0.1 and they
  // sit far too loud here. The Rust mobile builds ran the same effect at 0.01,
  // which is the direction this is headed.
  stepTaken: 0.03,
  knifeThrown: 0.3,
  gunShot: 0.8,
  loudGunShot: 1.0,
  bulletBounced: 0.2,
  zoneChange: 0.7,
  ammoCollected: 0.6,
};
const DEFAULT_VOLUME = 0.8;

const buffers = new Map(); // name -> AudioBuffer
let ctx = null;
let master = null;         // the sfx-volume bus every clip plays through
let loading = null;
let muted = false;
let sfxVolume = 0.65;

// Kicks off the decode of every clip. Fire-and-forget: main.js doesn't await
// it, and a sound that fires before its buffer lands simply doesn't play —
// same as the old element-based version before `preload` finished.
export function loadAudio() {
  if (loading) return loading;
  const context = ensureContext();
  if (!context) return Promise.resolve();
  installGestureResume();
  loading = Promise.all(Object.entries(SOURCES).map(async ([name, src]) => {
    try {
      const res = await fetch(src);
      buffers.set(name, await decode(context, await res.arrayBuffer()));
    } catch {
      // A clip that won't load stays silent rather than breaking the boot.
    }
  }));
  return loading;
}

export function playSfx(name, opts = {}) {
  if (muted) return;
  const buffer = buffers.get(name);
  if (!buffer || !ctx || !master) return;
  // Still waiting on the first gesture. Starting a node on a suspended
  // context queues it, so every queued sound would fire at once on resume.
  if (ctx.state !== "running") return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (opts.jitter) source.playbackRate.value = 1 + (Math.random() - 0.5) * opts.jitter;

  const gain = ctx.createGain();
  gain.gain.value = clamp(opts.volume ?? VOLUMES[name] ?? DEFAULT_VOLUME, 0, 1);

  source.connect(gain).connect(master);
  source.start();
  // Drop both nodes out of the graph once the clip finishes — a source node is
  // single-use, and leaving them connected would grow the graph unbounded.
  source.onended = () => { source.disconnect(); gain.disconnect(); };
}

export function setMuted(next) { muted = !!next; }
export function isMuted() { return muted; }

export function setSfxVolume(v) {
  sfxVolume = clamp(v, 0, 1);
  if (master) master.gain.value = sfxVolume;
}
export function getSfxVolume() { return sfxVolume; }

// Created on first loadAudio() rather than at import time so the module stays
// importable under node (the unit tests pull it in transitively via combat.js).
function ensureContext() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = sfxVolume;
  master.connect(ctx.destination);
  return ctx;
}

// Safari only grew promise-based decodeAudioData in 14.5, and the callback
// form is still the one that works everywhere. Accept whichever the engine
// hands back.
function decode(context, bytes) {
  return new Promise((resolve, reject) => {
    const maybe = context.decodeAudioData(bytes, resolve, reject);
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
}

let gestureHooked = false;
function installGestureResume() {
  if (gestureHooked || typeof window === "undefined") return;
  gestureHooked = true;
  const detach = () => {
    window.removeEventListener("keydown", resume, true);
    window.removeEventListener("pointerdown", resume, true);
  };
  const resume = () => {
    if (!ctx) return detach();
    if (ctx.state === "running") return detach();
    ctx.resume().then(detach).catch(() => {});
  };
  window.addEventListener("keydown", resume, true);
  window.addEventListener("pointerdown", resume, true);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
