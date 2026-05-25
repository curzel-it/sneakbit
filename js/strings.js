// String table lookup. Loaded once at startup from data/strings.en.json.

let table = {};

export function loadStringsData(data) {
  table = data ?? {};
}

export function tr(key) {
  if (!key) return "";
  return table[key] ?? key;
}
