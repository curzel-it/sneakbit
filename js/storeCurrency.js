// Store currency selection + formatting. The four supported currencies (locked
// decision) are usd/eur/gbp/jpy. Selection resolves: a stored manual override →
// else a best-effort map from navigator.language's region → else usd.
//
// The override is a short string, so it's persisted to localStorage directly —
// the int-only storage.js KV can't hold it. Key mirrors the settings namespace.

const OVERRIDE_KEY = "sneakbit.settings.v1.store.currency";

export const SUPPORTED = ["usd", "eur", "gbp", "jpy"];

// Stripe zero-decimal currencies among ours: the amount is the whole unit, not
// 1/100. (Mirrors server/storeCatalog.js ZERO_DECIMAL.)
const ZERO_DECIMAL = new Set(["jpy"]);

// Eurozone ISO-3166 country codes we map to EUR. Not exhaustive of the EU, just
// the euro-using members — non-euro EU countries fall through to USD, which is
// the safe default (the manual picker covers the rest).
const EURO_COUNTRIES = new Set([
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
]);

function readOverride() {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return v && SUPPORTED.includes(v) ? v : null;
  } catch { return null; }
}

// Map navigator.language (e.g. "en-GB", "ja-JP", "de") to one of the four.
function fromLocale() {
  let lang = "";
  try { lang = (navigator.language || navigator.languages?.[0] || "").trim(); }
  catch { return "usd"; }
  if (!lang) return "usd";
  const parts = lang.split("-");
  const region = (parts[1] || "").toUpperCase();
  const primary = parts[0].toLowerCase();
  if (region === "GB" || primary === "cy") return "gbp"; // cy = Welsh
  if (region === "JP" || primary === "ja") return "jpy";
  if (region && EURO_COUNTRIES.has(region)) return "eur";
  // No region subtag: infer a couple of common euro languages by language alone.
  if (!region && ["de", "fr", "es", "it", "nl", "pt", "el", "fi"].includes(primary)) return "eur";
  return "usd";
}

export function getCurrency() {
  return readOverride() || fromLocale();
}

export function setCurrency(currency) {
  if (!SUPPORTED.includes(currency)) return false;
  try { localStorage.setItem(OVERRIDE_KEY, currency); } catch { /* ignore */ }
  return true;
}

// Render a smallest-unit amount in the given currency, using the user's locale
// for grouping/symbol placement. Divide by 100 only for non-zero-decimal
// currencies (JPY amounts are already whole yen).
export function format(amount, currency = getCurrency()) {
  const cur = String(currency).toLowerCase();
  const value = ZERO_DECIMAL.has(cur) ? (amount | 0) : (amount | 0) / 100;
  let locale;
  try { locale = navigator.language || undefined; } catch { locale = undefined; }
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: cur.toUpperCase() }).format(value);
  } catch {
    // Intl unavailable / bad currency — a plain fallback so the UI never breaks.
    return `${cur.toUpperCase()} ${value}`;
  }
}
