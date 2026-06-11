// SQLite persistence via Node's built-in node:sqlite (DatabaseSync) — zero
// npm deps. Opens the DB, runs idempotent migrations, and exports small
// query helpers that take the db handle as their first argument (so tests
// can pass a `:memory:` db and the route layer can share one connection).
//
// node:sqlite is stable/unflagged on Node 24+ (production runs 24); on older
// runtimes it's behind a flag. See tools/deploy.mjs NODE_MAJOR.

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
  // Additive: tokens minted before this instant are rejected (see
  // authenticateUser in bearerAuth.js), so changing/resetting a password
  // logs out every other session even though the JWTs are stateless. NULL on
  // pre-existing rows means "no cutoff" — their old tokens stay valid until
  // exp, which is the correct backward-compatible behavior.
  addColumnIfMissing(db, "users", "password_changed_at", "INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );
  `);
  // Cloud saves: one row per user holding the serialized progress blob.
  // `rev` is monotonic (optimistic-concurrency token for PUT); `updated_at`
  // is the authority for newest-wins conflict resolution on the client.
  db.exec(`
    CREATE TABLE IF NOT EXISTS saves (
      user_id    TEXT PRIMARY KEY REFERENCES users(id),
      blob       TEXT NOT NULL,
      rev        INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // Real-money store (Stripe). Entitlements are the account-bound "owned
  // forever" grants; purchases is the audit log + the join refunds need (a
  // refund event carries a payment_intent, not a sku); stripe_events is the
  // webhook de-dup ledger. All created idempotently here — no manual migration.
  db.exec(`
    CREATE TABLE IF NOT EXISTS entitlements (
      user_id     TEXT NOT NULL REFERENCES users(id),
      sku         TEXT NOT NULL,
      kind        TEXT NOT NULL,
      ref_id      TEXT NOT NULL,
      status      TEXT NOT NULL,
      source      TEXT NOT NULL,
      granted_at  INTEGER NOT NULL,
      revoked_at  INTEGER,
      PRIMARY KEY (user_id, sku)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchases (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL REFERENCES users(id),
      sku                   TEXT NOT NULL,
      stripe_payment_intent TEXT,
      amount                INTEGER NOT NULL,
      currency              TEXT NOT NULL,
      status                TEXT NOT NULL,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS purchases_pi ON purchases(stripe_payment_intent);`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_events (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );
  `);
}

// ALTER TABLE ADD COLUMN, but a no-op if the column already exists (node:sqlite
// throws on a duplicate add). Keeps migrate() safe to run on every boot.
function addColumnIfMissing(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

// — Users ———————————————————————————————————————————————————————————————

export function createUser(db, { id, email, passwordHash, displayName = null, now }) {
  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, email_verified, created_at, updated_at, password_changed_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).run(id, email, passwordHash, displayName, now, now, now);
  return findUserById(db, id);
}

export function findUserByEmail(db, email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) ?? null;
}

export function findUserById(db, id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) ?? null;
}

// Delete the user and everything tied to them (cloud save + any reset
// tokens). Wrapped in a transaction so a crash mid-delete can't orphan a
// save or reset row — SQLite FK cascade isn't enabled by default in
// node:sqlite, so we clean up dependents explicitly.
export function deleteUser(db, id) {
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM saves WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM entitlements WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM purchases WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// Patch display_name and/or password_hash. Only the provided fields change;
// updated_at always bumps. A password change also stamps password_changed_at
// to `now`, which retires every token issued before this moment.
export function updateUser(db, id, { displayName, passwordHash, now }) {
  const sets = [];
  const params = [];
  if (displayName !== undefined) { sets.push("display_name = ?"); params.push(displayName); }
  if (passwordHash !== undefined) {
    sets.push("password_hash = ?"); params.push(passwordHash);
    sets.push("password_changed_at = ?"); params.push(now);
  }
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

// Burn every still-pending reset for a user — called after a successful reset
// so a second outstanding link can't also be redeemed.
export function invalidateUserResets(db, userId, now) {
  db.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).run(now, userId);
}

// Opportunistic housekeeping: drop spent or long-expired reset rows so the
// table doesn't grow without bound. Called from the forgot-password path.
export function pruneStaleResets(db, now) {
  db.prepare(`DELETE FROM password_resets WHERE used_at IS NOT NULL OR expires_at < ?`).run(now);
}

// — Cloud saves ——————————————————————————————————————————————————————————

export function getSave(db, userId) {
  return db.prepare(`SELECT * FROM saves WHERE user_id = ?`).get(userId) ?? null;
}

// Upsert the blob, stamping the caller-provided rev + updated_at. The route
// layer computes the next rev and decides whether the write is allowed
// (optimistic concurrency); this helper just persists.
export function putSave(db, { userId, blob, rev, updatedAt }) {
  db.prepare(`
    INSERT INTO saves (user_id, blob, rev, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, rev = excluded.rev, updated_at = excluded.updated_at
  `).run(userId, blob, rev, updatedAt);
  return getSave(db, userId);
}

export function deleteSave(db, userId) {
  db.prepare(`DELETE FROM saves WHERE user_id = ?`).run(userId);
}

// — Store entitlements / purchases (Stripe) ——————————————————————————————

// Upsert so replays and re-purchase-after-refund are idempotent: a second
// grant of the same (user, sku) just re-activates the existing row.
export function grantEntitlement(db, { userId, sku, kind, refId, now }) {
  db.prepare(`
    INSERT INTO entitlements (user_id, sku, kind, ref_id, status, source, granted_at, revoked_at)
    VALUES (?, ?, ?, ?, 'active', 'stripe', ?, NULL)
    ON CONFLICT(user_id, sku) DO UPDATE SET status='active', granted_at=excluded.granted_at, revoked_at=NULL
  `).run(userId, sku, kind, refId, now);
}

export function revokeEntitlement(db, { userId, sku, now }) {
  db.prepare(`
    UPDATE entitlements SET status='revoked', revoked_at=? WHERE user_id=? AND sku=?
  `).run(now, userId, sku);
}

export function listActiveEntitlements(db, userId) {
  return db.prepare(`
    SELECT sku, kind, ref_id, granted_at FROM entitlements
    WHERE user_id = ? AND status = 'active'
    ORDER BY granted_at ASC
  `).all(userId);
}

export function hasActiveEntitlement(db, userId, sku) {
  const row = db.prepare(`
    SELECT 1 FROM entitlements WHERE user_id = ? AND sku = ? AND status = 'active'
  `).get(userId, sku);
  return !!row;
}

export function recordPurchase(db, { id, userId, sku, paymentIntent, amount, currency, now }) {
  db.prepare(`
    INSERT INTO purchases (id, user_id, sku, stripe_payment_intent, amount, currency, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      stripe_payment_intent = excluded.stripe_payment_intent, updated_at = excluded.updated_at
  `).run(id, userId, sku, paymentIntent ?? null, amount, currency, now, now);
}

export function findPurchaseByPaymentIntent(db, paymentIntent) {
  if (!paymentIntent) return null;
  return db.prepare(`SELECT * FROM purchases WHERE stripe_payment_intent = ?`).get(paymentIntent) ?? null;
}

export function markPurchaseRefunded(db, paymentIntent, now) {
  db.prepare(`
    UPDATE purchases SET status='refunded', updated_at=? WHERE stripe_payment_intent=?
  `).run(now, paymentIntent);
}

// Webhook de-dup: has this event id already been processed? Checked BEFORE
// dispatch so a replay is skipped; the id is only recorded (below) AFTER the
// handler succeeds, so a processing failure leaves it unseen and Stripe's retry
// re-processes (grants are idempotent, so re-processing is safe).
export function stripeEventSeen(db, id) {
  return !!db.prepare(`SELECT 1 FROM stripe_events WHERE id = ?`).get(id);
}

// Mark an event id processed. insert-or-ignore so a racing duplicate (two
// deliveries interleaving at await points before either records) is a no-op.
// Returns true if this call inserted the row (first to record it).
export function recordStripeEvent(db, { id, type, now }) {
  const res = db.prepare(`
    INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)
  `).run(id, type, now);
  return res.changes > 0;
}
