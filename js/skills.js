// Unlockable combat skills, mirroring the original game_core flags:
//   * piercing  → kunai does 2x damage (red ninja quest reward)
//   * boomerang → kunai bounces back on wall/kill   (black ninja)
//   * catcher   → caught bullets refund into ammo  (blue ninja)
//
// In-game acquisition path: reading the corresponding "gain_…_skill"
// dialogue marks dialogue.answer.<text>=1 (see dialogue.js::handleReward).
// has*Skill() reads those storage keys so the unlock survives reload
// without us needing a side cache.
//
// We keep a small per-skill devtools override (window.skills.on/off) in
// localStorage; an override pins the skill on/off regardless of the
// dialogue state. Useful for testing.

import { getValue, setValue } from "./storage.js?v=20260528f";

const DIALOGUE_KEYS = {
  piercing:  "dialogue.answer.quest.ninja_skills.red_ninja.gain_piercing_knife_skill",
  boomerang: "dialogue.answer.quest.ninja_skills.black_ninja.gain_bouncing_knifes_skill",
  catcher:   "dialogue.answer.quest.ninja_skills.blue_ninja.gain_knife_catcher_skill",
};

const OVERRIDE_KEY = "sneakbit.skills.override.v1";
const overrides = loadOverrides();
const listeners = new Set();

function loadOverrides() {
  const fallback = { piercing: null, boomerang: null, catcher: null };
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      piercing:  normaliseOverride(parsed.piercing),
      boomerang: normaliseOverride(parsed.boomerang),
      catcher:   normaliseOverride(parsed.catcher),
    };
  } catch {
    return fallback;
  }
}

function normaliseOverride(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return null;
}

function persistOverrides() {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides));
  } catch {}
  for (const fn of listeners) fn(getSkills());
}

function isUnlocked(name) {
  if (overrides[name] === true) return true;
  if (overrides[name] === false) return false;
  const key = DIALOGUE_KEYS[name];
  if (!key) return false;
  return getValue(key) === 1;
}

export function hasPiercingKnifeSkill() { return isUnlocked("piercing"); }
export function hasBoomerangSkill()      { return isUnlocked("boomerang"); }
export function hasBulletCatcherSkill()  { return isUnlocked("catcher"); }

// Devtools toggle: pins the flag on/off regardless of dialogue progress.
export function setSkill(name, on) {
  if (!(name in overrides)) return;
  overrides[name] = on == null ? null : !!on;
  persistOverrides();
}

// Grants the skill the way the in-game dialogue would: marks the
// "gain_*_skill" dialogue as answered. Useful for pickup/reward paths
// that want to unlock without going through the dialogue overlay.
export function unlockSkillFromGameplay(name) {
  const key = DIALOGUE_KEYS[name];
  if (!key) return;
  setValue(key, 1);
  for (const fn of listeners) fn(getSkills());
}

export function getSkills() {
  return {
    piercing:  hasPiercingKnifeSkill(),
    boomerang: hasBoomerangSkill(),
    catcher:   hasBulletCatcherSkill(),
  };
}

export function onSkillsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Re-emit listener updates when storage changes outside of this module
// (e.g. dialogue.js writes the dialogue.answer key on close).
export function _notifySkillsChanged() {
  for (const fn of listeners) fn(getSkills());
}

if (typeof window !== "undefined") {
  window.skills = {
    get:    getSkills,
    set:    setSkill,
    on:     (n) => setSkill(n, true),
    off:    (n) => setSkill(n, false),
    clear:  (n) => setSkill(n, null),
    unlock: unlockSkillFromGameplay,
  };
}
