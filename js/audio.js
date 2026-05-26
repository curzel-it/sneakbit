// Minimal audio: preload short SFX as HTMLAudioElement and clone on play
// so concurrent calls overlap. Mirrors the original game's SoundEffect ↔
// file mapping (game/src/features/audio.rs); call sites pass the same
// semantic names (e.g. "stepTaken", "knifeThrown") rather than file ids.
// We avoid AudioContext on purpose to dodge the first-user-gesture
// handshake — footsteps fire from key presses, which always count.

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
  stepTaken: 0.1,
  knifeThrown: 0.3,
  gunShot: 0.8,
  loudGunShot: 1.0,
  bulletBounced: 0.2,
  zoneChange: 0.7,
  ammoCollected: 0.6,
};
const DEFAULT_VOLUME = 0.8;

const buffers = new Map();
let muted = false;
let sfxVolume = 0.6;

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
  const base = opts.volume ?? VOLUMES[name] ?? DEFAULT_VOLUME;
  a.volume = clamp(base * sfxVolume, 0, 1);
  if (opts.jitter) a.playbackRate = 1 + (Math.random() - 0.5) * opts.jitter;
  a.play().catch(() => {});
}

export function setMuted(next) { muted = !!next; }
export function isMuted() { return muted; }
export function setSfxVolume(v) { sfxVolume = clamp(v, 0, 1); }
export function getSfxVolume() { return sfxVolume; }

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
