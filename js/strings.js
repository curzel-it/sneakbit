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
