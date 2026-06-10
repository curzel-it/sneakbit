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

import { getValue, setValue } from "./storage.js";

// Storage keys backing each skill's "owned" flag. The three ninja skills are
// unlocked by reading a "gain_…_skill" dialogue; the knockback aura is bought
// from the shop, so it has its own plain storage key. Both go through the same
// getValue/setValue store, so has*()/grant work identically for either origin.
const DIALOGUE_KEYS = {
  piercing:  "dialogue.answer.quest.ninja_skills.red_ninja.gain_piercing_knife_skill",
  boomerang: "dialogue.answer.quest.ninja_skills.black_ninja.gain_bouncing_knifes_skill",
  catcher:   "dialogue.answer.quest.ninja_skills.blue_ninja.gain_knife_catcher_skill",
  aura:      "skill.knockback_aura.owned",
};

const OVERRIDE_KEY = "sneakbit.skills.override.v1";
const overrides = loadOverrides();
const listeners = new Set();

function loadOverrides() {
  const fallback = { piercing: null, boomerang: null, catcher: null, aura: null };
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      piercing:  normaliseOverride(parsed.piercing),
      boomerang: normaliseOverride(parsed.boomerang),
      catcher:   normaliseOverride(parsed.catcher),
      aura:      normaliseOverride(parsed.aura),
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
export function hasKnockbackAura()       { return isUnlocked("aura"); }

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
    aura:      hasKnockbackAura(),
  };
}

// Shop-facing helpers, keyed by the same internal skill id used everywhere
// else (e.g. "aura"). Let the shop treat a skill good like a skin: check
// ownership, grant on purchase, and read display metadata — without the shop
// needing to know each skill's storage key.
export function skillInfo(id)  { return SKILL_INFO[id] || null; }
export function hasSkill(id)   { return id in DIALOGUE_KEYS ? isUnlocked(id) : false; }
export function grantSkill(id) { unlockSkillFromGameplay(id); }

// Display metadata for each skill. The inventory screen lists the unlocked
// ones plainly, alongside keys and other non-weapon pickups. `icon` is the
// [row, col] tile on the inventory sheet, matching inventory_texture_offset.
// `preview` (optional) is an animated strip on the weapons sheet — the shop
// showcase loops it instead of the static icon; same layout convention as a
// pickable weapon's on-ground idle (x,y tile coords; frames laid out along x).
export const SKILL_INFO = {
  piercing:  { name: "Piercing Kunai",  desc: "Kunai deals 2× damage.",            icon: [12, 9] },
  boomerang: { name: "Boomerang Kunai", desc: "Kunai bounces back on wall/kill.",  icon: [12, 7] },
  catcher:   { name: "Bullet Catcher",  desc: "Caught bullets refund into ammo.",  icon: [12, 8] },
  aura:      {
    name: "Knockback Aura",
    desc: "At <10% HP, blast nearby enemies back for 25% of their HP. 30s cooldown.",
    icon: [13, 9],
    preview: { sheet: "weapons", x: 97, y: 53, w: 1, h: 1, frames: 4 },
  },
};

// The skills you've actually earned, ready to list in the inventory as
// non-selectable "owned" items (like keys). Locked skills are omitted —
// you only see a skill once you've earned it.
export function unlockedSkills() {
  const unlocked = getSkills();
  return Object.keys(SKILL_INFO)
    .filter((id) => unlocked[id])
    .map((id) => ({ id, name: SKILL_INFO[id].name, desc: SKILL_INFO[id].desc, icon: SKILL_INFO[id].icon }));
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
