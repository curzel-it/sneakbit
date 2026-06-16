// Creative-mode predicate. The single source of truth other features consult
// to gate the map editor and zone-authoring tools.
//
// Creative mode is now a LOCAL-ONLY tool: it activates only when the page is
// served from localhost AND `?creative=true` is set. It writes edits straight
// into this repo's data/<id>.json (see localZoneFiles.js), so it must never
// engage on the deployed site — hence the local-origin requirement, which is
// what keeps it out of production entirely.
//
// The flag is read once at boot and cached for the whole session (no in-game
// switch). Default is `false`.

let cached = null;

// Local origin: a dev server on localhost/127.0.0.1, or a file:// page. This
// gate is what removes production exposure — the editor only ever runs against
// a local checkout of the repo.
export function isLocalHost() {
  if (typeof location === "undefined") return false;
  if (location.protocol === "file:") return true;
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "";
}

export function isCreativeMode() {
  if (cached !== null) return cached;
  if (typeof location === "undefined") return false;
  // Local-only: the editor writes to the repo's data/ files, so it must never
  // engage on the deployed site regardless of the URL flag.
  if (!isLocalHost()) { cached = false; return cached; }
  const params = new URLSearchParams(location.search);
  // Guests don't own the world — letting them flip creative mode (which
  // gates "walk through anything" and the map editor) would only desync
  // their local view. Hard-disable for guests; host/offline read the
  // ?creative= flag as before.
  if (params.has("join")) { cached = false; return cached; }
  const raw = (params.get("creative") || "").toLowerCase();
  cached = raw === "true" || raw === "1" || raw === "yes";
  return cached;
}

// Test hook: tests instantiate this module without a real `location`,
// so let them force the predicate to a known value.
export function _setCreativeModeForTesting(v) {
  cached = !!v;
}
