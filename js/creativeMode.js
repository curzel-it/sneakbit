// Creative-mode predicate. Mirrors Rust's `is_creative_mode()` — the
// single source of truth other features consult to gate behavior. The
// HTML port reads `?creative=true` from the URL at boot so the toggle
// is stable for the whole session (no in-game switch); same shape as
// the Rust desktop build that reads the flag once from `argv`.
//
// Default is `false`. See creative-mode-requirements.md for the list
// of behaviors each gate is supposed to change once we wire them up;
// today this module only powers the save export/import gating.

let cached = null;

export function isCreativeMode() {
  if (cached !== null) return cached;
  if (typeof location === "undefined") return false;
  const params = new URLSearchParams(location.search);
  const raw = (params.get("creative") || "").toLowerCase();
  cached = raw === "true" || raw === "1" || raw === "yes";
  return cached;
}

// Test hook: tests instantiate this module without a real `location`,
// so let them force the predicate to a known value.
export function _setCreativeModeForTesting(v) {
  cached = !!v;
}
