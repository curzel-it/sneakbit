// Auth endpoint handlers. createAuthHandler() wires the db + jwt + passwords
// + email + rate-limiters into one async dispatcher that index.js calls for
// every /auth/* request (CORS is applied by the caller, mirroring the
// /turn-credentials pattern). All responses are JSON.
//
// Endpoints:
//   POST  /auth/register         {email, password, displayName?} -> {token, user}
//   POST  /auth/login            {email, password}               -> {token, user}
//   GET   /auth/me               (Bearer)                        -> {user}
//   PATCH /auth/me               (Bearer) {displayName?, password?, currentPassword?}
//   POST  /auth/forgot-password  {email}                         -> always 200
//   POST  /auth/reset-password   {token, password}               -> {token, user}

import { randomBytes, createHash } from "node:crypto";
import {
  createUser, findUserByEmail, findUserById, updateUser,
  createPasswordReset, findPasswordReset, markPasswordResetUsed,
} from "./db.js";
import { signToken, verifyToken } from "./jwt.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { readJsonBody } from "./httpBody.js";
import { sendEmail } from "./email.js";
import { createRateLimiter } from "./rateLimitHttp.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createAuthHandler({ db, env = process.env } = {}) {
  // Brute-force defense. login/reset are per-IP; forgot is per-IP and
  // per-email so one address can't be spammed from many IPs (and one IP
  // can't enumerate many addresses).
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
  const resetLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
  const forgotIpLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });
  const forgotEmailLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

  async function handle(req, res) {
    if (!env.JWT_SECRET) return json(res, 503, { error: "auth_unavailable" });
    const path = pathOf(req.url);
    const method = req.method;
    try {
      if (method === "POST" && path === "/auth/register") return await register(req, res);
      if (method === "POST" && path === "/auth/login") return await login(req, res);
      if (method === "GET" && path === "/auth/me") return await me(req, res);
      if (method === "PATCH" && path === "/auth/me") return await patchMe(req, res);
      if (method === "POST" && path === "/auth/forgot-password") return await forgot(req, res);
      if (method === "POST" && path === "/auth/reset-password") return await reset(req, res);
      return json(res, 404, { error: "not_found" });
    } catch (err) {
      if (err?.code === "BODY_TOO_LARGE") return json(res, 413, { error: "too_large" });
      if (err?.code === "BAD_JSON") return json(res, 400, { error: "bad_json" });
      console.error("[auth] handler error", { path, err: err?.message || String(err) });
      return json(res, 500, { error: "server_error" });
    }
  }

  // — Handlers ———————————————————————————————————————————————————————————

  async function register(req, res) {
    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const displayName = cleanDisplayName(body.displayName);
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: "invalid_email" });
    if (!validPassword(password)) return json(res, 400, { error: "weak_password" });
    if (findUserByEmail(db, email)) return json(res, 409, { error: "email_taken" });

    const id = "usr_" + randomBytes(12).toString("hex");
    const passwordHash = await hashPassword(password);
    const now = Date.now();
    const user = createUser(db, { id, email, passwordHash, displayName, now });
    return json(res, 201, { token: tokenFor(user), user: publicUser(user) });
  }

  async function login(req, res) {
    if (!loginLimiter.check(clientIp(req))) return json(res, 429, { error: "rate_limited" });
    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const user = findUserByEmail(db, email);
    // Run a verify even when the user is absent so the response time doesn't
    // reveal whether the email exists.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, "AAAA$AAAA");
    if (!user || !ok) return json(res, 401, { error: "invalid_credentials" });
    return json(res, 200, { token: tokenFor(user), user: publicUser(user) });
  }

  async function me(req, res) {
    const user = userFromBearer(req);
    if (!user) return json(res, 401, { error: "unauthorized" });
    return json(res, 200, { user: publicUser(user) });
  }

  async function patchMe(req, res) {
    const user = userFromBearer(req);
    if (!user) return json(res, 401, { error: "unauthorized" });
    const body = await readJsonBody(req);
    const patch = { now: Date.now() };

    if (body.displayName !== undefined) {
      patch.displayName = cleanDisplayName(body.displayName);
    }
    if (body.password !== undefined) {
      const next = String(body.password);
      if (!validPassword(next)) return json(res, 400, { error: "weak_password" });
      const current = String(body.currentPassword ?? "");
      if (!(await verifyPassword(current, user.password_hash))) {
        return json(res, 403, { error: "wrong_password" });
      }
      patch.passwordHash = await hashPassword(next);
    }
    if (patch.displayName === undefined && patch.passwordHash === undefined) {
      return json(res, 400, { error: "nothing_to_update" });
    }
    const updated = updateUser(db, user.id, patch);
    return json(res, 200, { user: publicUser(updated) });
  }

  async function forgot(req, res) {
    const ip = clientIp(req);
    const body = await readJsonBody(req);
    const email = normalizeEmail(body.email);
    // Rate-limit, then ALWAYS answer 200 — no account enumeration. We still
    // do the work (issue + email a token) only when the address exists.
    const allowed = forgotIpLimiter.check(ip) && (email ? forgotEmailLimiter.check(email) : true);
    if (allowed && EMAIL_RE.test(email)) {
      const user = findUserByEmail(db, email);
      if (user) {
        const token = randomBytes(32).toString("hex");
        const tokenHash = sha256(token);
        createPasswordReset(db, {
          tokenHash, userId: user.id, expiresAt: Date.now() + RESET_TTL_MS,
        });
        const link = `${baseUrl()}/?reset=${token}`;
        await sendEmail({
          to: user.email,
          subject: "Reset your SneakBit password",
          html: `<p>Someone asked to reset your SneakBit password.</p>
<p><a href="${link}">Click here to choose a new password</a>. This link expires in 1 hour.</p>
<p>If you didn't request this, you can ignore this email.</p>`,
          text: `Reset your SneakBit password: ${link} (expires in 1 hour). If you didn't request this, ignore this email.`,
        }, env);
      }
    }
    return json(res, 200, { ok: true });
  }

  async function reset(req, res) {
    if (!resetLimiter.check(clientIp(req))) return json(res, 429, { error: "rate_limited" });
    const body = await readJsonBody(req);
    const token = String(body.token ?? "");
    const password = String(body.password ?? "");
    if (!validPassword(password)) return json(res, 400, { error: "weak_password" });
    const row = findPasswordReset(db, sha256(token));
    if (!row || row.used_at != null || row.expires_at < Date.now()) {
      return json(res, 400, { error: "invalid_token" });
    }
    const user = findUserById(db, row.user_id);
    if (!user) return json(res, 400, { error: "invalid_token" });
    const now = Date.now();
    const updated = updateUser(db, user.id, { passwordHash: await hashPassword(password), now });
    markPasswordResetUsed(db, row.token_hash, now);
    // Sign them straight in — they just proved control of the inbox.
    return json(res, 200, { token: tokenFor(updated), user: publicUser(updated) });
  }

  // — Helpers ————————————————————————————————————————————————————————————

  function tokenFor(user) {
    return signToken({ sub: user.id }, { secret: env.JWT_SECRET });
  }

  function userFromBearer(req) {
    const token = bearerToken(req);
    if (!token) return null;
    const payload = verifyToken(token, { secret: env.JWT_SECRET });
    if (!payload?.sub) return null;
    return findUserById(db, payload.sub);
  }

  function baseUrl() {
    return (env.APP_BASE_URL || "https://sneakbit.curzel.it").replace(/\/$/, "");
  }

  return handle;
}

// — Pure helpers ————————————————————————————————————————————————————————

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj) + "\n");
}

function pathOf(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function cleanDisplayName(name) {
  if (name == null) return null;
  const s = String(name).trim().slice(0, 60);
  return s.length ? s : null;
}

function validPassword(pw) {
  return typeof pw === "string" && pw.length >= MIN_PASSWORD && pw.length <= MAX_PASSWORD;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? null,
    emailVerified: !!row.email_verified,
    createdAt: row.created_at,
  };
}

function bearerToken(req) {
  const h = req.headers?.authorization;
  if (typeof h !== "string") return null;
  const prefix = "bearer ";
  if (h.length <= prefix.length || h.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  return h.slice(prefix.length).trim() || null;
}

function clientIp(req) {
  // nginx sets X-Forwarded-For / X-Real-IP; take the first hop. Falls back
  // to the socket address for direct (test / dev) connections.
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}
