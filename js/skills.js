// Unlockable combat skills, mirroring the original game_core flags:
//   * piercing  → kunai does 2x damage (red ninja quest reward)
//   * boomerang → kunai bounces back on wall/kill   (black ninja)
//   * catcher   → caught bullets refund into ammo  (blue ninja)
//
// The unlock mechanism (quest / dialogue) is intentionally not wired up
// yet — the rest of combat just reads has*Skill() at runtime. For now we
// expose toggles on `window.skills` so the skills can be flipped from the
// devtools console.

const STORAGE_KEY = "sneakbit.skills.v1";

const state = load();
const listeners = new Set();

function load() {
  const fallback = { piercing: false, boomerang: false, catcher: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      piercing:  !!parsed.piercing,
      boomerang: !!parsed.boomerang,
      catcher:   !!parsed.catcher,
    };
  } catch {
    return fallback;
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  for (const fn of listeners) fn({ ...state });
}

export function hasPiercingKnifeSkill() { return state.piercing; }
export function hasBoomerangSkill()      { return state.boomerang; }
export function hasBulletCatcherSkill()  { return state.catcher; }

export function setSkill(name, on) {
  if (!(name in state)) return;
  state[name] = !!on;
  persist();
}

export function getSkills() { return { ...state }; }

export function onSkillsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  window.skills = {
    get: getSkills,
    set: setSkill,
    on:  (n) => setSkill(n, true),
    off: (n) => setSkill(n, false),
  };
}
