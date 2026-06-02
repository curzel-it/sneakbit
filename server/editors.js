// Editor allowlist. A user is an "editor" — allowed to read/write the
// server-side creative-mode worlds (see editingRoutes.js) — iff their account
// email is in this set. Default is the hard-coded list below; EDITOR_EMAILS (a
// comma-separated env var) can extend it on the VPS without a code change.
//
// Pure + env-injected so it's trivially unit-testable and so authRoutes.js can
// stamp the resulting `editor` flag onto the public user object.

const HARDCODED = ["federico@curzel.it"];

function normalize(email) {
  return String(email ?? "").trim().toLowerCase();
}

// The full lowercase set for a given env. Rebuilt per call (cheap, a handful of
// entries) so a live EDITOR_EMAILS change takes effect without a restart.
export function editorEmails(env = process.env) {
  const extra = String(env.EDITOR_EMAILS ?? "")
    .split(",")
    .map(normalize)
    .filter(Boolean);
  return new Set([...HARDCODED.map(normalize), ...extra]);
}

export function isEditor(email, env = process.env) {
  const e = normalize(email);
  if (!e) return false;
  return editorEmails(env).has(e);
}
