// Shared bearer-token authentication for the account + cloud-save routes.
// Both authRoutes.js and savesRoutes.js resolve the caller the same way, so
// the logic — parse `Authorization: Bearer <jwt>`, verify the signature,
// load the user — lives here once.
//
// On top of the stateless JWT it enforces a `password_changed_at` cutoff: a
// token whose `iat` predates the user's last password change/reset is
// rejected. That's what makes "change password" actually end other sessions
// despite there being no server-side session table to revoke.

import { verifyToken } from "./jwt.js";
import { findUserById } from "./db.js";

export function bearerToken(req) {
  const h = req.headers?.authorization;
  if (typeof h !== "string") return null;
  const prefix = "bearer ";
  if (h.length <= prefix.length || h.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  return h.slice(prefix.length).trim() || null;
}

// Returns the authenticated user row, or null for any failure (missing/garbage
// token, bad signature, expired, deleted user, or a token retired by a later
// password change). Callers treat null as "unauthorized" and never branch on
// why.
export function authenticateUser(req, { db, secret }) {
  const token = bearerToken(req);
  if (!token) return null;
  const payload = verifyToken(token, { secret });
  if (!payload?.sub) return null;
  const user = findUserById(db, payload.sub);
  if (!user) return null;
  if (tokenPredatesPasswordChange(user, payload)) return null;
  return user;
}

// password_changed_at is stored in ms; the JWT `iat` is in seconds. A token
// issued in the same second as the change survives (`>`), so the fresh token
// minted alongside a password change isn't immediately invalidated.
function tokenPredatesPasswordChange(user, payload) {
  const pca = user.password_changed_at;
  if (!pca || typeof payload.iat !== "number") return false;
  return Math.floor(pca / 1000) > payload.iat;
}
