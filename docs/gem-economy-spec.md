# Gem economy & real-money payments — specification

Status: **implementation-ready** · Designed 2026-06-09 · Expanded with technical
detail 2026-06-11

> **Product decisions locked (2026-06-09):** v1 is **web/Stripe only**; **gems→coins
> is one-way** (no coins→gems, no reconcile-on-wipe); exchange rate **1 gem = 10
> coins**. The doc below reflects these. Earlier alternatives are kept as struck
> context where useful — the abuse surface and the provenance bookkeeping are gone
> because one-way conversion removes them entirely.

> **2026-06-11 expansion:** every section now carries implementation-grade detail
> grounded in the current codebase (file names, helper signatures, transaction
> shapes, wire formats). Three design-level corrections were made while grounding:
> the convert transaction is specified in **SQLite/node:sqlite** terms (the earlier
> draft used Postgres `SELECT … FOR UPDATE` idiom that doesn't exist here); the
> ledger idempotency index now **includes `user_id`** (a global unique on
> `(source, external_id)` would let an attacker pre-burn another user's
> `requestId`); and `gem_ledger` deliberately has **no foreign key** to `users`
> (ledger rows must outlive account deletion, and `node:sqlite` enforces FKs).
> §16 is a new implementation plan; §8 is a new section on doing Stripe with zero
> npm dependencies, which the `server/` "no deps" rule requires and which Stripe's
> API comfortably allows.

The next layer on top of the [coin economy](coin-economy.md): a way for players to
spend **real money** (EUR / USD / other currencies) and have that value persist
across saves and devices. We do this with a second, **account-bound** currency —
**gems** — and a payment system wired into the existing user accounts
(`server/authRoutes.js`, `server/db.js`, `js/accountSession.js`). Sibling spec:
[account entitlements](account-entitlements-spec.md) (durable weapons/skins) reuses
the patterns established here.

This document is a design spec to implement later. Nothing here is built yet.

---

## 1. Why a second currency

Coins (today) are **per-save**: they live in `localStorage` under
`sneakbit.kv.v1.player.{i}.coins` (`js/wallet.js` over `js/storage.js`), are part
of the cloud-save blob (`js/saveBlob.js` captures the whole `sneakbit.kv.v1.*`
namespace), and a **New game (wipe save)** resets them to 0. That's correct for an
in-game economy, but it means anything bought with *coins* dies with the save.

Real money must **not** die with a save. So real money never buys coins directly.
Instead:

- **Real money → gems.** Gems are bought with money and attached to the **user
  account**, server-side. They survive new games, reinstalls, and device changes,
  as long as the account exists.
- **Gems → coins (one-way).** Inside a game the player converts gems into coins to
  actually spend them (the shop, future sinks). This is the only thing gems *do*,
  and it is **final** — like spending money. There is no coins→gems path.

The mental model: **gems are the durable store of value; coins are the volatile
spendable.** Gems are a vault attached to your account; coins are the cash you
pull out for one playthrough — and like cash, once pulled out and not spent, a
wipe loses it. Your founding worry ("don't lose my €10 on a new game") is solved
because the **gems** are durable; only coins you already cashed out and left
unspent are at risk on a wipe.

```
  real money ──(Stripe)──▶ GEMS (server, per-account, durable)
                            │
                  gems→coins│  (one-way, final — no path back)
                            ▼
                          COINS (localStorage, per-save, already cloud-synced)
                            │
                  coins→spent (shop, future sinks)
```

> **Why no coins→gems.** It was tempting (bank leftover coins back on a wipe), but
> coins are client-authoritative (`localStorage`, trivially editable), so any
> coins→gems path lets a cheater mint real-money-equivalent gems by *asserting* a
> coin burn. One-way conversion deletes that entire abuse surface and the
> per-save provenance bookkeeping it would have required. Gems stay a genuine
> premium tier: there is simply **no way to turn earned coins into gems**.

---

## 2. Goals & non-goals

**Goals**
- Logged-in users can buy gems with real money from the **account section of the
  game menu** (`js/accountPanel.js`), and only there for now.
- Gems are **server-authoritative** and **per-account** — never lost with a save.
- **Gem → coin conversion** (one-way) at a fixed rate of **1 gem = 10 coins**.
- A complete, auditable **transaction ledger** (purchases, conversions, refunds).
- Card data **never touches our server** (use a hosted payment flow).
- Idempotent, fraud-resistant crediting (webhook-driven, never redirect-driven).

**Non-goals (this pass)**
- **Native platform IAP** (Steam Microtransactions, Apple StoreKit, Google Play
  Billing). v1 is **web/Stripe only** — see §3, this is the load-bearing scope cut.
- Gem **cash-out / withdrawal**. Gems are one-way: money in, never money out. (This
  is what keeps the whole thing out of "real-money trading" / regulated territory.)
- Gifting, trading, or transferring gems between accounts.
- Subscriptions / battle passes / recurring billing. One-off pack purchases only.
- Spending gems *directly* on anything. Gems only convert to coins; coins are the
  spend currency (keeps every existing sink — the shop — unchanged). (The
  entitlements spec reserves a `source:'gem'` for future premium cosmetics; that
  would be a server-side grant inside the billing flow, additive to this design.)
- **coins→gems conversion of any kind** (see §1). Gems→coins is one-way and final.
- Co-op shared gem pools. Gems are per *account*, period; co-op wallets stay coin-only.

---

## 3. Platform & provider scope — the big constraint

The account/server is **shared across every platform** this game ships on (web,
Steam/Electron, iOS, Android — see `[[desktop-electron-steam]]`). But the rules
for charging money differ sharply by platform:

| Platform | How money *must* flow for digital goods | Notes |
|---|---|---|
| **Web** (sneakbit.curzel.it) | **Stripe** (or similar) is fine | Full multi-currency, our control. |
| **Steam** (Electron build) | **Steam Microtransactions** (MicroTxn API) | Valve policy expects in-app purchases to use Steam's system; ~30% cut. |
| **iOS** | **Apple StoreKit IAP** — mandatory | Cannot sell premium currency via Stripe inside the app; ~15–30%. |
| **Android** | **Google Play Billing** — mandatory | Same as Apple. |

Because gems land on a shared account, a player could in principle buy gems cheaply
on the web and spend them in the iOS app — which Apple/Google treat as
**circumventing their IAP** if you steer users to it from inside the app. Getting
this wrong risks app-store rejection or removal.

**v1 scope (locked): web/Stripe only.**
- The "Buy gems" UI is shown **only on the web build**, and only to logged-in users.
- On Steam/iOS/Android the account panel still shows the **gem balance** and allows
  **gem→coin conversion** (spending what you already own is always fine), but the
  **purchase** entry point is hidden, or replaced with neutral copy ("Manage gems on
  the web"). No in-app link that steers a mobile user to the web store (that's the
  part the stores forbid).
- Native IAP per platform is a **separate, later milestone**. The server's gem
  ledger and crediting path are designed provider-agnostic (§6/§7) so adding a
  Steam/Apple/Google "payment source" later is additive, not a rewrite.

**Implementation note (verified):** this repository currently *is* the web build —
there is no Electron/iOS/Android shell in the codebase yet, and no platform-detect
module. So v1 needs **no client-side platform gating at all**: the Buy section's
visibility is driven purely by the server's `buyEnabled` flag in `GET
/billing/catalog` (§7), which is `false` until Stripe keys are configured. When a
native shell lands later, it gets a platform-detect feature file whose only billing
job is to force the Buy section off; the server flag stays the master switch.

---

## 4. The two currencies side by side

| | **Coins** (exists today) | **Gems** (new) |
|---|---|---|
| Bought with | in-game (monster drops) + gems→coins | **real money** |
| Lives in | `localStorage` (`player.{i}.coins`), in cloud-save blob | **server DB**, per `user_id` |
| Authority | **client** (already fully client-trusted) | **server** (real money — never trust client) |
| Scope | per **save** (a new game wipes them) | per **account** (durable) |
| Survives new game? | no | **yes** |
| Requires account? | no | **yes** (gems are an account feature) |
| Requires online? | no | **yes** to buy/convert (read can be cached) |
| Spendable on | the shop & future coin sinks | nothing directly — only converts to coins |
| Co-op | per-hero wallet, local co-op folds P2→P1 | account-level, not co-op-aware |

---

## 5. Conversion semantics

**One direction only: gems → coins, and it is final.** (Rationale for no path back
is in §1.)

### 5.1 Rate
A single fixed exchange rate, server-defined: **1 gem = 10 coins** (`RATE = 10`, a
constant in `server/billingRoutes.js`). It's exposed via `GET /billing/catalog`;
the client reads it from there and never hard-codes it (so retuning is a one-line
server change). The converter UI computes its preview from the fetched rate.

### 5.2 The conversion
- **gems → coins:** debit `g` gems (server, atomic — §7.3), then the client
  credits `g × RATE` coins to its `localStorage` wallet via
  `addCoins(coinsCredited, 0)` (`js/wallet.js` — player index 0; local co-op
  already folds P2→P1 onto that slot). Always exact — no rounding, no remainder,
  no loss. Server-side caps: `g` must be an integer, `1 ≤ g ≤ 100_000` per request
  (1M coins — far above any shop price, comfortably inside the `| 0` int32 range
  `storage.js` coerces to).
- There is no inverse. Coins are never converted to gems and a save wipe simply
  loses whatever coins remain (gems, being on the account, are untouched).

### 5.3 Trust (now trivial)
Because conversion is one-way *out of* the server-authoritative asset, the trust
model is clean: the server debits gems under its own authority and merely *tells*
the client it may add coins. The client can already mint coins freely
(`localStorage`), so authorizing it to add the coins it just paid gems for changes
nothing. **The whole "client mints gems by faking a coin burn" abuse surface is
gone** — there is no coins→gems endpoint to attack. The only thing the server ever
trusts the client for is its own (already-untrusted) coin balance, exactly as today.

---

## 6. Data model (server)

All new, additive migrations appended to `migrate()` in `server/db.js` (same
`CREATE TABLE IF NOT EXISTS` / `addColumnIfMissing` discipline already there; new
indexes use `CREATE INDEX IF NOT EXISTS` so `migrate()` stays safe to run on every
boot). **The ledger is the source of truth; the balance is a cached materialized
total** kept in lockstep inside the same SQL transaction.

### 6.1 Concurrency model (read this first)

`server/db.js` uses Node's built-in **`node:sqlite` `DatabaseSync`** — fully
**synchronous**, one shared connection (opened lazily by `getDb()` in
`server/index.js`, shared by auth/saves/editing and now billing). That gives us a
much simpler atomicity story than the client/server DB the earlier draft assumed:

- There is **no `SELECT … FOR UPDATE`** and no row lock — those are Postgres
  idioms. There is also no need for them: all SQL on this connection executes
  synchronously on the one Node thread, so **two requests can never interleave
  statements** as long as a multi-statement unit never `await`s between its
  statements.
- Multi-statement units (check balance → update wallet → insert ledger row) are
  wrapped in `db.exec("BEGIN") … COMMIT/ROLLBACK` exactly like the existing
  `deleteUser` — the transaction is for **crash consistency** (a power cut can't
  leave wallet and ledger disagreeing), not for concurrency.
- **Hard rule for the implementer:** between `BEGIN` and `COMMIT` there must be
  **no `await`** (no Stripe call, no body read, nothing async). Read the request
  body and do all network I/O first; then run the synchronous SQL unit.

### 6.2 Schema

```sql
-- Cached gem balance, one row per user. Always equals SUM(amount) over the
-- ledger for that user; kept as a column so reads are O(1). Created lazily on
-- a user's first credit (no row = balance 0).
CREATE TABLE IF NOT EXISTS gem_wallets (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  gems       INTEGER NOT NULL DEFAULT 0,   -- may go < 0 only via refund/chargeback clawback (§10)
  updated_at INTEGER NOT NULL
);

-- Append-only ledger. Every gem movement is one row; balance = running sum.
-- Never UPDATE or DELETE a row — corrections are new compensating rows.
--
-- NOTE: user_id deliberately has NO foreign key. node:sqlite enforces FK
-- constraints, and ledger rows must OUTLIVE account deletion (financial
-- audit/refund obligations — §6.5), so they can't reference users(id).
CREATE TABLE IF NOT EXISTS gem_ledger (
  id             TEXT PRIMARY KEY,         -- "gtx_" + randomBytes(12).toString("hex") (mirrors usr_ ids)
  user_id        TEXT NOT NULL,
  amount         INTEGER NOT NULL,         -- + credit, - debit (gems)
  kind           TEXT NOT NULL,            -- 'purchase' | 'gems_to_coins' | 'refund' | 'chargeback' | 'admin'
  -- provenance / idempotency
  source         TEXT,                     -- 'stripe' | 'convert' | 'admin' (later: 'steam' | 'apple' | 'google')
  external_id    TEXT,                     -- Stripe event id (evt_…) for stripe rows; client requestId for convert rows
  payment_intent TEXT,                     -- Stripe PaymentIntent id (pi_…) on purchase rows; the join key
                                           -- refund/chargeback handling uses to find the purchase (§10)
  meta           TEXT,                     -- JSON: see §6.3
  created_at     INTEGER NOT NULL
);

-- Idempotency: one ledger row per (user, source, external_id). user_id is part
-- of the key ON PURPOSE — a global UNIQUE(source, external_id) would let an
-- attacker "pre-burn" a victim's convert requestId by inserting it under their
-- own account first, turning the victim's legitimate convert into a unique-
-- constraint failure. Scoped per user, your requestIds are yours alone.
-- (Stripe event ids are globally unique anyway, so including user_id costs
-- nothing on the stripe side.)
CREATE UNIQUE INDEX IF NOT EXISTS gem_ledger_user_source_ext
  ON gem_ledger(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Ledger paging (GET /billing/ledger) and the balance==SUM audit query.
CREATE INDEX IF NOT EXISTS gem_ledger_user_time ON gem_ledger(user_id, created_at);

-- Refund/chargeback → original purchase lookup (§10).
CREATE INDEX IF NOT EXISTS gem_ledger_pi ON gem_ledger(payment_intent)
  WHERE payment_intent IS NOT NULL;

-- Every payment-provider event we have processed (or deliberately ignored),
-- for webhook idempotency pre-check + audit + dispute forensics. The raw
-- payload is kept verbatim. INSERT OR IGNORE on the provider event id.
CREATE TABLE IF NOT EXISTS payment_events (
  id          TEXT PRIMARY KEY,            -- provider event id (evt_…)
  source      TEXT NOT NULL,               -- 'stripe'
  type        TEXT NOT NULL,               -- 'checkout.session.completed', 'charge.refunded', …
  payload     TEXT NOT NULL,               -- raw JSON body, verbatim
  received_at INTEGER NOT NULL
);
```

### 6.3 `meta` JSON shapes (informal, per `kind`)

| kind | meta |
|---|---|
| `purchase` | `{ packId, sessionId, amountTotal, currency }` (`amountTotal` in Stripe's minor units, e.g. cents) |
| `gems_to_coins` | `{ coinsCredited, rate }` — **`coinsCredited` is load-bearing**: a replayed `requestId` returns it from this row (§7.3) |
| `refund` / `chargeback` | `{ packId, originalLedgerId, chargeId? }` |
| `admin` | `{ note }` |

### 6.4 db helpers (new exports from `server/db.js`)

Same style as the existing helpers: synchronous, db handle first, object params.
All multi-statement helpers own their `BEGIN/COMMIT/ROLLBACK` internally (callers
never compose transactions across helpers — keeps the no-await rule local).

```js
// Read. null when the user has never been credited — treat as {gems: 0}.
export function getGemWallet(db, userId) // -> {user_id, gems, updated_at} | null

// The one writer. Inserts a ledger row AND upserts the wallet in one
// transaction. Returns {entry, gems} (gems = new balance).
// Throws on (user_id, source, external_id) unique violation — callers that
// expect replays catch/pre-check instead (see the two wrappers below).
export function appendGemEntry(db, {
  id, userId, amount, kind, source = null, externalId = null,
  paymentIntent = null, meta = null, now,
}) // -> {entry, gems}

// Purchase credit, idempotent on the Stripe event id. If a row for
// (userId, 'stripe', eventId) already exists, returns it with applied:false
// and touches nothing. The ONLY path that credits purchases (webhook, §9).
export function creditGemPurchase(db, {
  userId, gems, eventId, paymentIntent, packId, sessionId,
  amountTotal, currency, now,
}) // -> {applied: bool, entry, gems}

// The convert debit (§7.3). Single transaction:
//   1. replay check: existing row for (userId, 'convert', requestId)?
//      -> {ok:true, replayed:true, coinsCredited: meta.coinsCredited, gems}
//   2. balance check: (wallet?.gems ?? 0) < gemsRequested
//      -> {ok:false, error:'insufficient_gems', gems}
//   3. debit: appendGemEntry(amount: -gemsRequested, kind:'gems_to_coins',
//      source:'convert', externalId: requestId,
//      meta:{coinsCredited: gemsRequested*rate, rate})
//      -> {ok:true, replayed:false, coinsCredited, gems}
export function convertGemsToCoins(db, { userId, gems, requestId, rate, now })

// Compensating row for a refund/chargeback (§10), idempotent on eventId.
// `amount` is negative; MAY drive the wallet below zero (by design).
export function clawbackGems(db, {
  userId, amount, kind /* 'refund'|'chargeback' */, eventId,
  paymentIntent, originalLedgerId, packId, now,
}) // -> {applied: bool, gems}

export function findPurchaseByPaymentIntent(db, paymentIntent)
  // -> ledger row with kind='purchase' | null  (refund→purchase join, §10)

export function listGemLedger(db, userId, { limit = 50, before = null })
  // -> rows WHERE user_id=? [AND created_at < before]
  //    ORDER BY created_at DESC, id DESC LIMIT min(limit, 200)

export function recordPaymentEvent(db, { id, source, type, payload, now })
  // -> bool (false = already seen). INSERT OR IGNORE; the cheap idempotency
  //    pre-check the webhook runs before doing any work.
```

Audit invariant (unit-tested, also a handy ops query):
`SELECT gems FROM gem_wallets WHERE user_id=?` ≡
`SELECT COALESCE(SUM(amount),0) FROM gem_ledger WHERE user_id=?`.

### 6.5 Account deletion

`deleteUser` in `server/db.js` grows two lines inside its existing transaction:

- `DELETE FROM gem_wallets WHERE user_id = ?` — the balance dies with the account
  (any remaining gems are forfeited; the confirm copy in the delete-account flow
  must say so — §11).
- `gem_ledger` rows are **kept untouched** (that's why the table has no FK). They
  record real financial transactions we may need for refunds/disputes/accounting
  long after the account is gone. The orphaned `user_id` string is effectively a
  tombstone: the `users` row is gone, so it no longer maps to an identity or an
  email. `payment_events` likewise stays. (Final retention call is a policy
  question — §17.2 — but **keep** is the implemented default.)

### 6.6 Gem packs catalog

Server-side static config, `server/gemPacks.js` — a plain exported constant, not a
DB table (like the shop stock). Single source of truth for what each pack grants.
The client never sends gem amounts or prices; it sends a `packId`.

```js
// server/gemPacks.js
// Stripe Price ids come from env so test mode (price_test_…) and live mode can
// differ per deployment without a code change.
export function getGemPacks(env = process.env) {
  return [
    { id: "gems_500",  gems: 500,  stripePriceId: env.STRIPE_PRICE_500  || null, label: "500 gems" },
    { id: "gems_1200", gems: 1200, stripePriceId: env.STRIPE_PRICE_1200 || null, label: "1,200 gems", bonus: "+20%" },
    { id: "gems_3000", gems: 3000, stripePriceId: env.STRIPE_PRICE_3000 || null, label: "3,000 gems", bonus: "+50%" },
  ].filter((p) => p.stripePriceId);
}
export function findGemPack(env, packId) { /* by id, null if absent */ }
```

Prices, currencies, and localization live in **Stripe** (multi-currency Prices), so
we don't reimplement FX. The pack config only maps `packId → {gems, stripePriceId}`.
(Exact pack lineup/price points are still an open product question — §17.1; the
three-tier shape above is illustrative.)

---

## 7. Server API

New handler `server/billingRoutes.js`, mirroring `authRoutes.js`/`savesRoutes.js`
exactly: `createBillingHandler({ db, env = process.env, stripe })` returns one
async `handle(req, res)` dispatcher; `index.js` calls it for every `/billing/*`
request; all responses JSON via the same local `json(res, status, obj)` helper;
errors map `BODY_TOO_LARGE → 413`, `BAD_JSON → 400`, anything else logs
`billing.handlerError` and returns 500. The `stripe` param is the injectable glue
object from `server/stripe.js` (§8) — tests pass a stub so no unit test ever
touches the network.

All routes return `503 {error:"auth_unavailable"}` when `env.JWT_SECRET` is unset
(same as saves). Checkout and webhook additionally return
`503 {error:"billing_unavailable"}` when Stripe env keys are absent. Bearer
resolution uses the shared `authenticateUser(req, { db, secret })` from
`server/bearerAuth.js`.

### 7.1 Route table

| Method & path | Auth | Body / params | Returns / errors |
|---|---|---|---|
| `GET /billing/catalog` | none | — | `200 { rate, buyEnabled, packs:[{id,gems,label,bonus}] }`. `stripePriceId` is **not** exposed. `buyEnabled = !!(STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET)` and packs is `[]` when keys are absent. |
| `GET /billing/wallet` | bearer | — | `200 { gems, updatedAt }` (`{gems:0, updatedAt:null}` when no wallet row). `401 unauthorized`. |
| `GET /billing/ledger` | bearer | `?limit=50&before=<createdAt>` | `200 { entries:[{id,amount,kind,meta,createdAt}], nextBefore }` — `nextBefore` = last entry's `createdAt`, or `null` when the page wasn't full. `meta` is parsed JSON or null. |
| `POST /billing/checkout` | bearer | `{ packId }` | `200 { url }` (Stripe Checkout Session URL). `400 unknown_pack`, `429 rate_limited`, `502 stripe_error` (Stripe API call failed), `503 billing_unavailable`. |
| `POST /billing/webhook` | **Stripe signature** | raw Stripe event | `200` always once the signature verifies (even for ignored event types — Stripe retries non-2xx for days). `400 invalid_signature` otherwise. The **only** path that credits a purchase. |
| `POST /billing/convert` | bearer | `{ gems, requestId }` | `200 { gems, coinsCredited, replayed }`. `400 invalid_request` (bad amount/requestId shape), `402 insufficient_gems`, `429 rate_limited`. |

### 7.2 Validation & rate limits

- `packId`: must resolve via `findGemPack` — never trust anything else from the
  client about a purchase.
- `gems` (convert): `Number.isInteger`, `1 ≤ gems ≤ 100_000`.
- `requestId`: `/^[A-Za-z0-9-]{8,64}$/` (a `crypto.randomUUID()` fits). It is an
  opaque idempotency key, never interpreted.
- Rate limiting reuses `createRateLimiter` from `server/rateLimitHttp.js` and the
  `clientIp(req)` helper (lift it from `authRoutes.js` into a tiny shared module
  or duplicate the 15 lines — implementer's call; it's nginx `X-Real-IP`-aware):
  - checkout: `{windowMs: 15*60*1000, max: 10}` keyed by **user id** (checkout is
    authenticated; per-user beats per-IP behind NATs).
  - convert: `{windowMs: 15*60*1000, max: 60}` keyed by user id.
  - webhook: no custom limiter — signature verification + the `payment_events`
    idempotency pre-check already bound the work; Stripe's own delivery is the
    only legitimate caller.

### 7.3 The convert transaction (normative)

`POST /billing/convert` is **atomic and idempotent**. Flow inside the handler,
after bearer auth and body validation (body fully read *before* any SQL — §6.1):

```
convertGemsToCoins(db, { userId, gems, requestId, rate: RATE, now: Date.now() })
  BEGIN
    row = SELECT * FROM gem_ledger
          WHERE user_id=? AND source='convert' AND external_id=?     -- replay?
    if row: COMMIT → {ok, replayed:true, coinsCredited: row.meta.coinsCredited}
    bal = SELECT gems FROM gem_wallets WHERE user_id=?               -- absent ⇒ 0
    if bal < gems: ROLLBACK → {ok:false, error:'insufficient_gems'}
    INSERT INTO gem_ledger (amount=-gems, kind='gems_to_coins',
                            source='convert', external_id=requestId,
                            meta='{"coinsCredited":gems*RATE,"rate":RATE}', …)
    INSERT INTO gem_wallets (user_id, gems, updated_at) VALUES (?, -gems, ?)
      ON CONFLICT(user_id) DO UPDATE SET gems = gems + excluded.gems,
                                         updated_at = excluded.updated_at
  COMMIT → {ok:true, replayed:false, coinsCredited: gems*RATE}
```

No locks, no `FOR UPDATE` — the synchronous single connection (§6.1) makes the
unit indivisible; `BEGIN/COMMIT` makes it crash-consistent. A repeat with the same
`requestId` returns the **original** `coinsCredited` without a second debit, so a
dropped response never double-charges gems. Note the replay's `gems` balance in
the response is the *current* balance (it may have moved since the original call);
the client uses only `coinsCredited` for the wallet credit and treats `gems` as
display state.

The server **cannot directly change coins** (coins are client-local). `/convert`
returns "add `coinsCredited` coins" and the client calls `addCoins(coinsCredited, 0)`
only on a 200. Crash recovery between the debit and the local add is the client's
pending-convert protocol — §12.3.

### 7.4 Wiring into `server/index.js`

Mirrors the existing lazy handlers exactly:

- Extend `isAuthScoped(url)` with `|| url === "/billing" || url.startsWith("/billing/") || url.startsWith("/billing?")`
  so `/billing/*` gets `applyAuthCors` + the lazy-db treatment. (The webhook is a
  server-to-server POST from Stripe with no `Origin` header — CORS headers on its
  response are inert, so no special-casing is needed; its protection is the
  signature, §8.2.)
- Add `let billingHandler = null; function getBillingHandler() { … }` cloning
  `getSavesHandler()`, constructing
  `createBillingHandler({ db: d, stripe: createStripe(process.env) })`.
- In the `isAuthScoped` dispatch chain, route `req.url.startsWith("/billing")` to
  `getBillingHandler()`.

### 7.5 Environment & gating matrix

New env vars (same `.env` pattern as `JWT_SECRET`; on the VPS they go into the
`sneakbit-server` systemd unit's environment, deployed via `tools/deploy.mjs`):

| Var | Used for |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…`/`sk_live_…` — Checkout Session creation (§8.1) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` — webhook signature verification (§8.2) |
| `STRIPE_PRICE_500` etc. | Price ids per pack (§6.6) |
| `APP_BASE_URL` | already exists (reset emails) — reused for success/cancel URLs (§9) |

Gating ("off unless configured", parallels `[[accounts-auth-ops]]`):

| Configured | Behavior |
|---|---|
| no `JWT_SECRET` | all `/billing/*` → 503 `auth_unavailable` (handler never constructed — `getDb()` returns null) |
| `JWT_SECRET` only | wallet/ledger/convert/catalog work; `buyEnabled:false`, packs `[]`; checkout/webhook → 503 `billing_unavailable`. **The whole gems→coins economy functions without Stripe** — only buying needs it. |
| both + Stripe vars | everything on |

---

## 8. Stripe glue with zero dependencies (`server/stripe.js`)

The server rule is **vanilla node:http, no npm deps** — and the Stripe npm SDK is
not needed. We use exactly two Stripe surfaces, both trivial over `fetch` (global
in Node 24, which production runs) and `node:crypto`:

### 8.1 Creating a Checkout Session

One form-encoded POST (Stripe's API takes `application/x-www-form-urlencoded`,
bracket syntax for nesting):

```js
// server/stripe.js
export function createStripe(env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  return {
    enabled: !!(key && env.STRIPE_WEBHOOK_SECRET),

    async createCheckoutSession({ priceId, userId, packId, successUrl, cancelUrl }) {
      const body = new URLSearchParams({
        mode: "payment",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": "1",
        success_url: successUrl,        // contains literal {CHECKOUT_SESSION_ID} — see §9
        cancel_url: cancelUrl,
        client_reference_id: userId,
        "metadata[userId]": userId,
        "metadata[packId]": packId,
        // Copy onto the PaymentIntent too: charge.refunded / dispute events
        // carry the PI, not the session, so this keeps provenance reachable
        // from every event family we consume (§10).
        "payment_intent_data[metadata][userId]": userId,
        "payment_intent_data[metadata][packId]": packId,
      });
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": crypto.randomUUID(),  // belt & braces on network retries
          "stripe-version": STRIPE_API_VERSION,    // pin it — one constant at top of file
        },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`stripe ${res.status}: ${data?.error?.message || "unknown"}`);
      return { id: data.id, url: data.url };
    },

    verifyWebhookSignature, // (rawBody, sigHeader) → bool — below
  };
}
```

`/billing/checkout` then is: auth → `findGemPack` → `createCheckoutSession` →
`200 {url}`. Nothing is written to the DB at checkout time — an abandoned session
costs us nothing and credits nothing.

### 8.2 Verifying the webhook signature

Stripe signs `POST /billing/webhook` with the `Stripe-Signature` header:
`t=<unix-seconds>,v1=<hex hmac>[,v1=<hex hmac>…]` (multiple `v1` during secret
rolls). Verification — ~20 lines, `node:crypto` only:

1. Parse `t` and all `v1` values.
2. `expected = HMAC-SHA256(key = STRIPE_WEBHOOK_SECRET, msg = `${t}.${rawBody}`)`
   hex — the **`whsec_…` string verbatim** is the key, and `rawBody` is the
   **exact raw request bytes** (UTF-8 string of them), not re-serialized JSON.
3. Accept if any `v1` passes `crypto.timingSafeEqual` against `expected`
   (compare equal-length buffers only).
4. Reject if `|now/1000 − t| > 300` (5-minute replay tolerance, Stripe's default).

Because the signature covers the raw bytes, the webhook handler **cannot** use
`readJsonBody` (it parses and trims). Add a sibling export to `server/httpBody.js`:

```js
// Same drain-on-overflow contract as readJsonBody, but resolves the raw
// Buffer untouched — webhook signatures are computed over exact bytes.
export function readRawBody(req, { maxBytes = 1024 * 1024 } = {}) // → Promise<Buffer>
```

The handler reads raw → verifies → `JSON.parse`es only after the signature holds.

### 8.3 Webhook event handling

After signature verification, idempotency pre-check, then dispatch on `type`:

```
const event = JSON.parse(rawBody);
if (!recordPaymentEvent(db, { id: event.id, source:'stripe', type: event.type,
                              payload: rawBody.toString('utf8'), now }))
  return 200;                            // duplicate delivery — done, fast path
switch (event.type) { … }                // each branch idempotent AGAIN via the
return 200;                              // ledger unique index (defense in depth)
```

| `event.type` | Action |
|---|---|
| `checkout.session.completed` | `s = event.data.object`. Skip (still 200) unless `s.payment_status === "paid"` (async payment methods complete later — out of v1 scope, log and ignore). `userId = s.metadata.userId \|\| s.client_reference_id` — verify the user exists (`findUserById`); if deleted mid-checkout, log `billing.orphanPurchase` and skip. `pack = findGemPack(env, s.metadata.packId)`; unknown → log loudly, skip (a pack was removed while a session was in flight). Then `creditGemPurchase(db, { userId, gems: pack.gems, eventId: event.id, paymentIntent: s.payment_intent, packId: pack.id, sessionId: s.id, amountTotal: s.amount_total, currency: s.currency, now })`. |
| `charge.refunded` | `c = event.data.object` (a Charge; `c.payment_intent` is set). Find the purchase via `findPurchaseByPaymentIntent`; absent → log, skip. Clawback the **full** pack gem amount (`amount: -purchase.amount`, kind `'refund'`) idempotently on `event.id`. v1 treats any refund as full — partial refunds are an explicit non-goal (§17.3); `charge.refunded` fires once per charge with `amount_refunded` cumulative, and our idempotency on the purchase's single clawback row keeps repeats harmless. |
| `charge.dispute.created` | Same clawback shape, kind `'chargeback'`, via the dispute's `payment_intent`. |
| anything else | Record in `payment_events` (already done), return 200. We subscribe the webhook endpoint only to the three types above in the Stripe dashboard, so "anything else" is rare by construction. |

### 8.4 Ops setup (checklist, not code)

- Stripe dashboard: create the Products/Prices (multi-currency), copy Price ids
  into env; add a webhook endpoint `https://sneakbit.curzel.it/billing/webhook`
  subscribed to the three event types; copy its `whsec_…`.
- Local dev: `stripe listen --forward-to localhost:8090/billing/webhook` (Stripe
  CLI) and the CLI-printed `whsec_…` in `.env`. Test cards (`4242 4242 4242 4242`)
  end-to-end in test mode.
- nginx already proxies all paths to the Node server; no config change expected
  (the webhook is a plain POST ≤ a few KB).

---

## 9. Purchase flow (Stripe Checkout)

Hosted Stripe Checkout — no card data ever reaches our server (PCI scope ≈ zero;
SAQ A).

```
Player (logged-in, web)        Client (js)              Server                 Stripe
        │  click "Buy 1,200 gems"  │                       │                      │
        │─────────────────────────▶│  POST /billing/checkout {packId}            │
        │                          │──────────────────────▶│                      │
        │                          │                       │  create Checkout     │
        │                          │                       │  Session (price,     │
        │                          │                       │  client_reference_id │
        │                          │                       │  =userId, metadata)  │
        │                          │                       │─────────────────────▶│
        │                          │   { url }             │◀───── session url ───│
        │                          │◀──────────────────────│                      │
        │   location.href = url  (full-page nav to Stripe-hosted Checkout)        │
        │─────────────────────────────────────────────────────────────────────▶ │
        │   enter card, pay ……………………………………………………………………………………………………▶ │
        │                          │                       │  checkout.session.   │
        │                          │                       │  completed (signed)  │
        │                          │                       │◀─────────────────────│
        │                          │                       │ verify sig; idempotent│
        │                          │                       │ INSERT ledger(+gems); │
        │                          │                       │ UPDATE gem_wallets    │
        │  redirected to success URL (cosmetic)            │                      │
        │◀─────────────────────────│  GET /billing/wallet (poll until gems update)│
```

- URLs the server passes to Stripe (built from the existing `APP_BASE_URL`
  helper pattern in `authRoutes.js`):
  `success_url = ${APP_BASE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`
  (the placeholder is **literal** — Stripe substitutes it),
  `cancel_url = ${APP_BASE_URL}/?checkout=cancel`.
- The redirect is a **full-page navigation away from the game** and back. That's
  fine: progress persists in `localStorage` on every change, and boot restores
  zone/position — the player returns to where they were, with the account panel
  reopened on the Gems view by the `?checkout=…` param (§12.4).
- The success page **does not credit**; it polls `/billing/wallet` (or shows
  "processing…") until the webhook lands, then reflects the new balance. Typical
  webhook latency is a second or two; show a spinner, not a number, until
  confirmed. The webhook usually *beats* the redirect, in which case the first
  poll already shows the new balance.

---

## 10. Refunds, chargebacks, disputes

- A Stripe **refund** or **chargeback** fires `charge.refunded` /
  `charge.dispute.created` webhooks. We handle them by writing a **negative
  compensating ledger row** (`kind:'refund'|'chargeback'`) for the gem value of
  that purchase and decrementing `gem_wallets.gems` — which **may drive the
  balance negative** if the player already converted/spent the gems. That's
  intended: a negative balance is a debt that future credits (purchases) net
  against; the player simply can't convert again until it's clear (the convert's
  balance check naturally enforces this — no special code). (Coins already spent
  are not clawed back — they're a sunk client-side asset.)
- Mechanically, the event→purchase join is the `payment_intent` column (§6.2):
  checkout stamps the PI id onto the purchase row; refund/dispute events carry the
  same PI; `findPurchaseByPaymentIntent` closes the loop. This is why §8.1 copies
  metadata onto the PaymentIntent as well — a human reading the Stripe dashboard
  during a dispute sees `userId`/`packId` right on the charge.
- Never delete or mutate the original purchase row; the refund is its own row. The
  ledger stays append-only and auditable.
- Decide a policy for repeat chargebackers (e.g. block future purchases). Out of
  scope to *build* now; the ledger makes it detectable later (§17.3).

---

## 11. Client UX

All DOM, per the project rule (no canvas UI). Lives with the account feature.

- **Entry point:** a new **"gems"** view inside `js/accountPanel.js`'s view set
  (alongside `signin/register/forgot/reset/account`), reachable from the `account`
  view by a **"Gems & Store"** button (added via the existing `linkRow` helper).
  Only meaningful when signed in; if the view is requested while signed out,
  `showView` falls through to `signin` (same guard `renderAccountView` already
  uses).
- **The gems view shows:** current gem balance (live via `onGemsChange`), a
  **"Buy gems"** section (pack cards from `/billing/catalog`, hidden entirely when
  `buyEnabled:false`), a **gems→coins converter** (stepper clamped to the current
  balance, preview line "N gems → N×10 coins", a "this can't be undone" note, and
  a confirm via the existing `showConfirm` dialog), and a **transaction history**
  list from `/billing/ledger` (date, kind, signed amount; a "load more" button
  driven by `nextBefore`). Offline or signed-out: balance may show from cache,
  Buy/Convert are disabled with the standard offline copy (`OFFLINE_MSG` pattern).
- **New game wording:** the **"New game (wipe save)"** button keeps its
  `localStorage.clear()` + reload flow (`js/menu.js`) — no gem reconciliation,
  there is no coins→gems. Two required adjustments:
  1. Confirm copy gains a line: unspent **coins are lost**, but **gems are safe on
     your account**.
  2. `localStorage.clear()` currently also wipes `sneakbit.account.v1` — i.e.
     **New game signs the player out** (verified in `menu.js`). Acceptable before
     money was involved; not after ("my gems are gone" panic). Fix: capture the
     account-session value before `clear()` and restore it immediately after
     (2 lines in the new-game handler, same for "Clear cache"). This is
     deliberately *not* a selective wipe — it's clear-then-restore of one key.
- **Live updates:** a new `js/gems.js` module mirrors `wallet.js`'s
  notifier pattern (`onGemsChange`) — see §12.1. No HUD gem chip in v1 — gems are
  an account-screen concept, not a moment-to-moment gameplay number.
- **Offline reads:** `gems.js` caches the last-known balance in `localStorage`
  (own key, **outside** `sneakbit.kv.v1.*` so it never enters the save blob),
  tagged with the user id so another account's stale number is never shown.

### New client files (one feature, one file)

| File | Responsibility |
|---|---|
| `js/gems.js` | Cached gem balance + subscriptions + the pending-convert recovery protocol. Mirrors `wallet.js` + `accountSession.js`. See §12.1/§12.3. |
| `js/billingApi.js` | Thin fetch wrappers for the `/billing/*` endpoints, cloning `accountApi.js`'s `request()` (never throws; `{ok,status,data,error,offline}`): `fetchCatalog()`, `fetchGemWallet(token)`, `fetchGemLedger(token, {limit, before})`, `createCheckout(token, {packId})`, `convertGems(token, {gems, requestId})`. |
| `js/gemStorePanel.js` | Builds + renders the gems **view subtree** (balance, pack cards, converter, ledger list) and exports it for `accountPanel` to mount: `buildGemsView()`, `renderGemsView()`, `resolveCheckoutReturn()`. `accountPanel.js` stays the owner of view switching/navigation; this file owns everything inside the view. (Same split as the entitlements spec assumes.) |

Server: `server/billingRoutes.js`, `server/gemPacks.js`, `server/stripe.js`, the
db helpers in `server/db.js` (§6.4), `readRawBody` in `server/httpBody.js`.

---

## 12. Client protocols (normative)

### 12.1 `js/gems.js` API

```js
export function getGems()            // number | null (null = unknown/never fetched)
export function onGemsChange(fn)     // subscribe, returns unsubscribe (wallet.js pattern)
export async function refreshGems()  // GET /billing/wallet → update cache + notify.
                                     // Offline/5xx: keep cache (accountSession's
                                     // revalidate posture). 401: clear to null.
export function initGems()           // boot hook, called once from main.js:
                                     //   - onAccountChange: sign-in → refreshGems(),
                                     //     sign-out → clear cache + notify(null)
                                     //   - retry a pending convert (§12.3)
export function _resetGemsForTesting()
```

Cache key: `sneakbit.gems.v1` → `{ userId, gems, updatedAt }`, raw
`localStorage` (NOT `storage.js` — that namespace is the cloud-saved blob; this
must not be). On load, the cache is honored only if `cache.userId ===
getUser()?.id`.

### 12.2 Buying

Pack card click → `createCheckout(getToken(), { packId })` → on `{ok}` set
`location.href = data.url`. Errors surface inline in the view (`messageFor`-style
mapping; notably `billing_unavailable` → "Purchases aren't available right now").
Nothing else — no local state; an abandoned checkout has no footprint.

### 12.3 Converting — the pending-convert protocol

The risk: server debits gems, response is lost (crash/tab close), client never
adds coins. The fix is a client-side write-ahead record + the server's
`requestId` idempotency (§7.3). At most one convert is in flight, ever:

1. Player confirms "Convert N gems". Generate `requestId = crypto.randomUUID()`.
2. **Before** the request, write `localStorage["sneakbit.gems.pendingConvert.v1"]
   = { requestId, gems: N, userId }`.
3. `POST /billing/convert {gems: N, requestId}`.
4. On `200`: `addCoins(data.coinsCredited, 0)` → **then** delete the pending
   record → update the cached balance from `data.gems`, notify, toast
   ("+N×10 coins").
5. On `402 insufficient_gems` / `400`: delete the pending record (the server
   provably did not debit), show the error.
6. On offline / 5xx / no response: leave the pending record. The Convert button
   shows "finishing a previous conversion…" while one is pending.
7. `initGems()` at boot (and on reconnect/sign-in): if a pending record exists
   for the current user, re-POST the **same** `requestId`+`gems`. The server
   replays the original result without a second debit; flow rejoins step 4.

Net guarantee: at most one debit, at most one matching coin credit. (A replay of
a convert that never reached the server simply performs it — the player did
confirm it.) The pending record is per-user-tagged like the cache, so switching
accounts can't replay across identities — a pending record for a *different* user
is dropped (its requestId is dead: never confirmed credited, and the other
account can retry it safely on its next sign-in… or it was already applied
server-side, in which case its gems were debited and its coins credited on that
account's device at the time. Either way, never replay it as the wrong user).

### 12.4 Returning from Checkout

`resolveCheckoutReturn()` in `gemStorePanel.js` mirrors
`accountSession.resolveResetToken`: parse `?checkout=success|cancel` (+
`session_id`) from `location.search`. `installAccountPanel()` calls it right where
it handles `?reset=` today:

- `success` → open the panel on the gems view in a "processing payment…" state:
  poll `refreshGems()` every 2 s until the balance increases or ~60 s elapse
  (then: "taking longer than usual — your gems will appear shortly", keep the
  panel usable). Strip the params via `history.replaceState` (the existing
  `stripResetParam` pattern) so a refresh doesn't re-enter the state.
- `cancel` → open the panel on the gems view, neutral "purchase canceled" note,
  strip params.

---

## 13. Edge cases & ordering

- **Convert ordering (no double-spend).** §12.3 is the full protocol; §7.3 the
  server half. Net: at most one debit, at most one matching coin credit.
- **Multi-device gems.** Gems are server-authoritative, so two devices see the
  same balance after a refresh. Two simultaneous converts on two devices are
  serialized by the synchronous transaction (§6.1) — the second sees the reduced
  balance and succeeds or 402s honestly. Coins, being per-save and cloud-synced,
  follow the existing newest-wins save model.
- **Co-op.** Gems are per account and not co-op-aware. Converting gems→coins
  credits the *local* coin wallet (which in local split-screen folds onto P1, per
  `wallet.js`). `[[creative-mode-singleplayer-only]]` and the TD/PvP coin gates are
  unchanged — gems never appear in those modes.
- **Signed-out players** never have gems (no account). The gems view routes them
  to sign-in. Coins work exactly as today.
- **Session expiry mid-checkout.** JWTs live 30 days (`jwt.js`); a Checkout
  session lives ~24 h — but crediting happens in the webhook keyed on the
  `userId` *baked into the session metadata at creation*, so the purchase lands
  even if the browser's token expires (or the password changes) while the player
  is on Stripe's page. Only the *redirect-time* wallet poll would 401, which just
  means "sign back in to see your balance".
- **Account deleted with a checkout in flight.** Webhook finds no user → logs
  `billing.orphanPurchase`, credits nothing (§8.3). The money side is then a
  manual-refund matter; the `payment_events` row preserves the evidence. Rare
  enough to keep manual. The delete-account confirm (`accountPanel.js`) gains a
  line: remaining gems are forfeited.
- **New game / Clear cache signing the player out** — fixed by clear-then-restore
  of the account-session key (§11). Gem cache (`sneakbit.gems.v1`) and any
  pending-convert record are *also* wiped by `clear()`; the former refetches on
  next panel open, the latter is restored along with the session key (add it to
  the same capture/restore pair) so an in-flight convert still completes.
- **Webhook arrives before the redirect** (common): first poll already shows the
  new balance — the "processing" state resolves instantly.
- **Stripe is down / misconfigured.** `/billing/checkout` → 502 `stripe_error`,
  shown inline; nothing was written anywhere. The rest of billing (and the whole
  game) is unaffected.

---

## 14. Security & anti-abuse (summary)

- Gem amounts and pack prices are **server-authoritative**; the client sends only
  a `packId`. Never trust a client-sent gem count or price.
- Purchases credit **only** via signature-verified webhooks (HMAC-SHA256 over the
  raw bytes, `timingSafeEqual`, 5-min replay window — §8.2), **idempotent** on the
  provider event id at two layers (`payment_events` pre-check + the ledger unique
  index). The browser success redirect credits nothing.
- The idempotency index is **scoped per user** (§6.2) so one account can't burn
  another's `requestId`.
- No coins→gems path exists, so there is no client-trusted gem-minting input to
  defend (the historical central abuse surface — see §5.3 — is designed out).
- Rate limits: checkout 10/15 min/user, convert 60/15 min/user (§7.2); webhook is
  bounded by signature + idempotency.
- Card data never reaches us (hosted Checkout). PCI scope minimized (SAQ A).
- Secrets via env (`STRIPE_*`); billing **off** unless configured (§7.5), exactly
  like `JWT_SECRET` gates auth. `assertStrongSecret`-style boot validation isn't
  needed — Stripe keys are high-entropy by construction; presence is the gate.
- The webhook body cap (`readRawBody` 1 MB) bounds memory; non-2xx is returned
  only for signature failures, so Stripe's retry machinery never hammers us over
  application-level skips.

---

## 15. Testing

Unit tests live in `tests/`, pure node, no framework (`node:test`), against
`openDb(":memory:")` — and `tests/savesRoutes.test.js` is the **template to
clone**: its `withServer(fn)` spins a real `node:http` server around the handler
with one seeded user + minted token; tests then drive it with plain `fetch`.

- **`tests/gemDb.test.js`** (db helpers, no HTTP): wallet==SUM(ledger) invariant
  after a mixed sequence; `creditGemPurchase` same-event-id replay credits once
  (`applied:false` second time); `convertGemsToCoins` — happy path, exact
  `coinsCredited = gems*rate`, `insufficient_gems` on short balance (and on no
  wallet row), `requestId` replay returns original `coinsCredited` with **one**
  debit row; `clawbackGems` drives the balance negative and a subsequent convert
  402s; per-user requestId scoping (same `requestId`, two users → two independent
  rows); `deleteUser` removes the wallet but leaves ledger rows.
- **`tests/billingRoutes.test.js`** (HTTP, `withServer` clone, with a **stub
  stripe** object injected — `createBillingHandler({db, env, stripe: fake})`):
  catalog shape + `buyEnabled:false` without keys + no `stripePriceId` leak;
  wallet 401 without bearer / `{gems:0}` fresh; checkout → `{url}` from the stub,
  `unknown_pack` 400, 503 without keys; convert status codes (200/400/402) +
  replay; ledger paging (`nextBefore` chaining, limit clamp); 503 when
  `JWT_SECRET` unset.
- **`tests/billingWebhook.test.js`**: build fixture events as JSON strings, sign
  them for real (the test computes `t=…,v1=HMAC(secret, t.body)` with
  `node:crypto` — exercising the verifier end to end); valid
  `checkout.session.completed` credits once; the **same body delivered twice**
  credits once; tampered body / stale `t` (> 5 min) → 400 and no credit;
  `charge.refunded` claws back via the `payment_intent` join; unknown event type
  → 200 + `payment_events` row only; `payment_status:"unpaid"` session credits
  nothing.
- **Client logic** (DOM-free): the pending-convert state machine in `gems.js`
  (write-ahead before send, delete on 200/400/402, retained on offline, replayed
  on init, dropped for a mismatched user) with stubbed `billingApi` + the
  localStorage shim the existing client tests use.
- **E2E** (`tests/e2e/gemConvert.test.mjs`): boots `node server/index.js` with a
  test `JWT_SECRET` (the existing `account.test.mjs` harness shape), registers a
  user through the real UI, seeds gems by opening the server's SQLite file
  directly from the test process (`node:sqlite`, one `creditGemPurchase`-shaped
  insert — no Stripe needed), then converts in the UI and asserts the coin HUD
  moved by ×10 and the gem balance dropped. **Note the convert economy is fully
  testable without Stripe keys** — only purchase needs Stripe, and that path is
  covered by the signed-fixture webhook tests plus a manual test-mode pass.
- **Manual** (pre-launch): Stripe test mode end to end — `stripe listen`
  forwarding, test card through real Checkout, refund from the dashboard, observe
  the clawback land.

Per `CLAUDE.md`: `npm run test:unit` before every commit; the new e2e joins
`npm run test:e2e` and self-skips without Chrome.

---

## 16. Implementation plan (for the implementing agent)

Four independently shippable milestones, each leaving `npm test` green. The gems
economy is usable (testable, demoable) from M2; money enters only at M3.

**M1 — server economy core (no Stripe).**
`server/db.js` migrations + helpers (§6) → `tests/gemDb.test.js` →
`server/billingRoutes.js` with catalog/wallet/ledger/convert only (checkout/webhook
return 503), `server/gemPacks.js` → `index.js` wiring (§7.4) →
`tests/billingRoutes.test.js`. No client change.

**M2 — client wallet & convert.**
`js/billingApi.js` → `js/gems.js` (cache, notifier, pending-convert protocol,
`initGems()` from `main.js`) → `js/gemStorePanel.js` + the `accountPanel.js`
integration (gems view, "Gems & Store" link) → converter UX with `showConfirm` →
New-game copy + account-session clear-then-restore in `menu.js` → client unit
tests + `tests/e2e/gemConvert.test.mjs`.

**M3 — Stripe purchases.**
`readRawBody` in `httpBody.js` → `server/stripe.js` (§8.1/8.2) → checkout +
webhook routes in `billingRoutes.js` (§8.3) → `tests/billingWebhook.test.js` →
pack cards + checkout-return handling in `gemStorePanel.js` (§12.2/12.4) →
Stripe test-mode env on dev, manual end-to-end (§8.4).

**M4 — money hygiene & launch.**
Refund/chargeback handlers (§10) + tests → delete-account confirm copy →
production Stripe setup (live keys in systemd env, dashboard webhook, live Prices)
→ `npm run deploy` → one live €-smallest-pack purchase + dashboard refund as the
production smoke test.

Verified integration anchors (so the implementer doesn't re-derive them): the
handler/`withServer` patterns are `savesRoutes.js`/`savesRoutes.test.js`; bearer
auth is `authenticateUser` (`bearerAuth.js`); rate limiting is
`createRateLimiter` (`rateLimitHttp.js`) + `clientIp` (`authRoutes.js`); CORS/lazy
wiring is `isAuthScoped`/`getSavesHandler` (`index.js`); client API style is
`accountApi.js` over `pickApiBase` (`apiBase.js`); the panel view set is
`accountPanel.js` (`views`/`showView`/`linkRow`); coin credit is
`addCoins(amount, playerIndex)` (`wallet.js`); the account-session localStorage
key is `sneakbit.account.v1` (`accountSession.js`); the New-game wipe is the
`#menu-new-game` handler (`menu.js`).

---

## 17. Open questions

Resolved 2026-06-09 (see header): platform scope (web/Stripe only), conversion
direction (gems→coins one-way), and rate (1 gem = 10 coins). Resolved 2026-06-11
by this expansion (flag if you disagree): no Stripe npm dependency (§8); ledger
kept on account deletion, no FK (§6.5); idempotency index per-user (§6.2);
New-game preserves the account session via clear-then-restore (§11); convert caps
and `requestId` format (§7.2); minimum conversion = 1 gem with a confirm dialog
(closes the old granularity question). Still open:

1. **Pack lineup & prices.** How many packs, what gem amounts, what EUR price
   points, and which "+X% bonus" tiers? Single currency to start, or Stripe
   multi-currency Prices from day one? (§6.6's three tiers are illustrative.)
   Sanity check at 1 gem = 10 coins: a shop priced in the hundreds–low-thousands
   of coins means a ~€5 pack probably wants to grant a few hundred to ~1,000
   gems — tune once the shop's coin prices are settled. Blocks only M3's
   dashboard setup; M1/M2 don't care.
2. **Ledger retention policy.** §6.5 implements **keep** (no FK, rows survive
   account deletion as orphans). Counsel may eventually want a retention window
   (e.g. anonymize `payment_events` payloads after N years); nothing in the
   schema fights that.
3. **Refund policy details.** v1: any refund/chargeback claws back the full pack
   (§8.3) and negative balances simply block converting. Partial refunds and
   repeat-chargebacker blocking are detectable from the ledger; build when needed.
4. **Legal/compliance.** Terms of sale, EU consumer right-of-withdrawal for
   digital goods (the standard pattern: the player consents to immediate delivery
   and waives withdrawal at Checkout — needs a checkbox or terms line), VAT/tax —
   **recommend Stripe Tax** on the Checkout Session (one param + dashboard
   registration) rather than hand-rolling; age limits for purchases. Out of build
   scope but must be settled before charging real money. The existing
   `terms.html` (linked from `accountPanel`'s legal footer) needs a purchases
   section.
