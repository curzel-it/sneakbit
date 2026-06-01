// SQLite persistence via Node's built-in node:sqlite (DatabaseSync) — zero
// npm deps. Opens the DB, runs idempotent migrations, and exports small
// query helpers that take the db handle as their first argument (so tests
// can pass a `:memory:` db and the route layer can share one connection).
//
// node:sqlite is stable/unflagged on Node 24+ (production runs 24); on older
// runtimes it's behind a flag. See deploy.py NODE_MAJOR.

import { DatabaseSync } from "node:sqlite";

export function openDb(path = process.env.DATABASE_PATH || "./data.db") {
  const db = new DatabaseSync(path);
  migrate(db);
  return db;
}

// CREATE TABLE IF NOT EXISTS only — safe to run on every boot. New columns
// in future migrations should also be additive (ALTER TABLE ADD COLUMN)
// guarded so a redeploy never destroys data.
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      email          TEXT NOT NULL UNIQUE,
      password_hash  TEXT NOT NULL,
      display_name   TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
  `);
  // Cloud saves (next milestone) slot in here as a third table, keyed by
  // user_id with a monotonic `rev` for last-writer-wins — purely additive,
  // no rework of the above. Left uncreated until that feature lands.
}

// — Users ———————————————————————————————————————————————————————————————

export function createUser(db, { id, email, passwordHash, displayName = null, now }) {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(id, email, passwordHash, displayName, now, now);
  return findUserById(db, id);
}

export function findUserByEmail(db, email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) ?? null;
}

export function findUserById(db, id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) ?? null;
}

// Patch display_name and/or password_hash. Only the provided fields change;
// updated_at always bumps.
export function updateUser(db, id, { displayName, passwordHash, now }) {
  const sets = [];
  const params = [];
  if (displayName !== undefined) { sets.push("display_name = ?"); params.push(displayName); }
  if (passwordHash !== undefined) { sets.push("password_hash = ?"); params.push(passwordHash); }
  sets.push("updated_at = ?"); params.push(now);
  params.push(id);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return findUserById(db, id);
}

// — Password resets ——————————————————————————————————————————————————————

export function createPasswordReset(db, { tokenHash, userId, expiresAt }) {
  db.prepare(`
    INSERT INTO password_resets (token_hash, user_id, expires_at, used_at)
    VALUES (?, ?, ?, NULL)
  `).run(tokenHash, userId, expiresAt);
}

export function findPasswordReset(db, tokenHash) {
  return db.prepare(`SELECT * FROM password_resets WHERE token_hash = ?`).get(tokenHash) ?? null;
}

export function markPasswordResetUsed(db, tokenHash, now) {
  db.prepare(`UPDATE password_resets SET used_at = ? WHERE token_hash = ?`).run(now, tokenHash);
}
