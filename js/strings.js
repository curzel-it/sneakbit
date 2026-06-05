// String table lookup. Loaded once at startup from data/strings.<lang>.json.
//
// Two tables: the active language and an English fallback. tr() prefers the
// active language but falls back to English (and finally the key itself) so a
// partially-translated locale never shows a raw key to the player. When the
// active language *is* English both tables are the same object.

let table = {};
let fallback = {};

export function loadStringsData(data, fallbackData) {
  table = data ?? {};
  fallback = fallbackData ?? table;
}

export function tr(key) {
  if (!key) return "";
  if (key in table) return table[key];
  if (key in fallback) return fallback[key];
  return key;
}

// Resolve a key to the platform-appropriate variant. On touch devices a
// `<key>.mobile` entry wins when one exists — even if it's an empty string,
// which is how a hint opts out of a platform (e.g. "press F to throw" makes
// no sense without a keyboard, so its `.mobile` variant is blank). We test
// for key *presence*, not truthiness, so a blank variant is honored as
// "show nothing here" rather than falling through to the desktop text.
// When no `.mobile` variant exists, or we're not on touch, behaves like tr().
export function trVariant(key, touch) {
  if (!key) return "";
  if (touch) {
    const m = `${key}.mobile`;
    if (m in table) return table[m];
    if (m in fallback) return fallback[m];
  }
  return tr(key);
}
