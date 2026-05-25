// Minimal audio: preload short SFX as HTMLAudioElement and clone on play
// so concurrent calls overlap. We avoid AudioContext on purpose to dodge
// the "first user gesture" handshake — footsteps fire from key presses,
// which always count as a gesture.

const SOURCES = {
  footstep: "./assets/audio/sfx_movement_footsteps1a.mp3",
  doorOpen: "./assets/audio/sfx_movement_dooropen1.mp3",
  interact: "./assets/audio/sfx_sounds_interaction22.mp3",
  neutral:  "./assets/audio/sfx_sound_neutral5.mp3",
  pickup:   "./assets/audio/sfx_sounds_powerup1.mp3",
};

const buffers = new Map();
let muted = false;
let volume = 0.6;

export function loadAudio() {
  for (const [name, src] of Object.entries(SOURCES)) {
    const a = new Audio();
    a.src = src;
    a.preload = "auto";
    buffers.set(name, a);
  }
}

export function playSfx(name, opts = {}) {
  if (muted) return;
  const proto = buffers.get(name);
  if (!proto) return;
  const a = proto.cloneNode(true);
  a.volume = clamp((opts.volume ?? 1) * volume, 0, 1);
  // Slight pitch jitter (via playbackRate) keeps repeated footsteps lively.
  if (opts.jitter) a.playbackRate = 1 + (Math.random() - 0.5) * opts.jitter;
  a.play().catch(() => {});
}

export function setMuted(next) { muted = !!next; }
export function isMuted() { return muted; }
export function setVolume(v) { volume = clamp(v, 0, 1); }
export function getVolume() { return volume; }

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
