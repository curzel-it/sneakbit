# Gem economy & real-money payments — specification

Status: **draft for review** · Date: 2026-06-09

> **Product decisions locked (2026-06-09):** v1 is **web/Stripe only**; **gems→coins
> is one-way** (no coins→gems, no reconcile-on-wipe); exchange rate **1 gem = 10
> coins**. The doc below reflects these. Earlier alternatives are kept as struck
> context where useful — the abuse surface and the provenance bookkeeping are gone
> because one-way conversion removes them entirely.

The next layer on top of the [coin economy](coin-economy.md): a way for players to
spend **real money** (EUR / USD / other currencies) and have that value persist
across saves and devices. We do this with a second, **account-bound** currency —
**gems** — and a payment system wired into the existing user accounts
(`server/authRoutes.js`, `server/db.js`, `js/accountSession.js`).

This document is a design spec to implement later. Nothing here is built yet.

---

## 1. Why a second currency

Coins (today) are **per-save**: they live in `localStorage` under
`sneakbit.kv.v1.player.{i}.coins`, are part of the cloud-save blob
(`js/saveBlob.js` captures the whole `sneakbit.kv.v1.*` namespace), and a **New
game (wipe save)** resets them to 0. That's correct for an in-game economy, but
it means anything bought with *coins* dies with the save.

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
  spend currency (keeps every existing sink — the shop — unchanged).
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
A single fixed exchange rate, server-defined: **1 gem = 10 coins** (`RATE = 10`).
It's a server constant exposed via the catalog endpoint; the client reads it from
there and never hard-codes it (so retuning is a one-line server change).

### 5.2 The conversion
- **gems → coins:** debit `g` gems (server, atomic, under a row lock), then the
  client credits `g × RATE` coins to its `localStorage` wallet via `addCoins`. Always
  exact — no rounding, no remainder, no loss.
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

All new, additive migrations in `server/db.js` (same `CREATE TABLE IF NOT EXISTS` /
`addColumnIfMissing` discipline already there). **The ledger is the source of
truth; the balance is a cached materialized total** kept in lockstep inside the same
SQL transaction.

```sql
-- Cached gem balance, one row per user. Always equals SUM(amount) over the
-- ledger for that user; kept as a column so reads are O(1) and the balance can
-- be checked under a row lock for atomic debits.
CREATE TABLE gem_wallets (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  gems       INTEGER NOT NULL DEFAULT 0,   -- never < 0 except via clawback (§9)
  updated_at INTEGER NOT NULL
);

-- Append-only ledger. Every gem movement is one row; balance = running sum.
-- Never UPDATE or DELETE a row — corrections are new compensating rows.
CREATE TABLE gem_ledger (
  id          TEXT PRIMARY KEY,            -- uuid
  user_id     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,            -- + credit, - debit (gems)
  kind        TEXT NOT NULL,               -- 'purchase' | 'gems_to_coins' | 'refund' | 'chargeback' | 'admin'
  -- provenance / idempotency
  source      TEXT,                        -- 'stripe' | 'steam' | 'apple' | 'google' | 'internal'
  external_id TEXT,                        -- Stripe event/session id, etc. UNIQUE per source for idempotency
  meta        TEXT,                        -- JSON: pack id, price, currency, coin amount, etc.
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX gem_ledger_source_ext ON gem_ledger(source, external_id)
  WHERE external_id IS NOT NULL;           -- a Stripe event credits exactly once

-- Processed payment-provider events, for webhook idempotency + audit even when
-- an event does NOT move gems (e.g. a duplicate delivery). Optional if the
-- ledger unique index above is deemed sufficient; keep for clean audit.
CREATE TABLE payment_events (
  id          TEXT PRIMARY KEY,            -- provider event id
  source      TEXT NOT NULL,
  type        TEXT NOT NULL,               -- 'checkout.session.completed', 'charge.refunded', ...
  payload     TEXT NOT NULL,               -- raw JSON, for dispute/debug
  received_at INTEGER NOT NULL
);
```

`deleteUser` (account deletion) must also clear `gem_wallets` and **decide what to
do with the ledger** — likely keep the ledger rows (anonymized or under a tombstone
user id) for financial/audit/refund obligations, since they represent real
transactions. Flag in Open Questions.

**Gem packs catalog** is server-side static config (a JS/JSON constant, not a DB
table — like the shop stock), the single source of truth for what each pack costs
and grants. The client never sends gem amounts or prices; it sends a `packId`.

```jsonc
// server/gemPacks.js (illustrative)
[
  { "id": "gems_500",  "gems": 500,  "stripePriceId": "price_…", "label": "500 gems"  },
  { "id": "gems_1200", "gems": 1200, "stripePriceId": "price_…", "label": "1,200 gems", "bonus": "+10%" },
  { "id": "gems_3000", "gems": 3000, "stripePriceId": "price_…", "label": "3,000 gems", "bonus": "+25%" }
]
```
Prices, currencies, and localization live in **Stripe** (multi-currency Prices), so
we don't reimplement FX. The pack config only maps `packId → {gems, stripePriceId}`.

---

## 7. Server API

New handler `server/billingRoutes.js` (mirrors `authRoutes.js` /
`savesRoutes.js`: `createBillingHandler({ db, env })`, bearer-authenticated except
the webhook). All return `503 auth_unavailable` when `JWT_SECRET` is unset, same as
saves. Gem-mutating routes require a valid bearer token.

| Method & path | Auth | Body / params | Returns |
|---|---|---|---|
| `GET /billing/catalog` | none | — | `{ rate, packs:[{id,gems,label,bonus}], buyEnabled }` (prices come from Stripe at checkout; `buyEnabled` is false on non-web/when keys absent) |
| `GET /billing/wallet` | bearer | — | `{ gems, updatedAt }` |
| `GET /billing/ledger` | bearer | `?limit&before` | `{ entries:[{id,amount,kind,meta,createdAt}], nextBefore }` (transaction history UI) |
| `POST /billing/checkout` | bearer | `{ packId }` | `{ url }` — a Stripe Checkout Session URL; `client_reference_id = userId`, `metadata.packId` |
| `POST /billing/webhook` | **Stripe signature** | raw Stripe event | `200` — verifies signature, credits gems idempotently (the *only* path that credits a purchase) |
| `POST /billing/convert` | bearer | `{ gems, requestId }` | `{ gems, coinsCredited }` — debit `gems`, authorize `gems × RATE` coins (gems→coins only) |

Notes:
- **Crediting a purchase happens only in the webhook**, never in `/checkout` or on
  the browser returning to a success URL. The redirect is cosmetic; Stripe's signed
  `checkout.session.completed` event is the truth. The webhook is idempotent on the
  Stripe event id (the `gem_ledger` unique index + `payment_events`).
- **`/convert` is atomic and idempotent.** `BEGIN; SELECT gems FOR UPDATE; if < gems
  requested reject (402); UPDATE gem_wallets; INSERT gem_ledger; COMMIT;` then return
  the coin-credit instruction. The client-supplied `requestId` dedupes retries: a
  repeat with the same `requestId` returns the original result without a second debit
  (so a dropped response never double-charges gems).
- The server **cannot directly change coins** (coins are client-local). `/convert`
  returns "add `coinsCredited` coins" and the client calls `addCoins(coinsCredited)`
  only on a 200. A crash after the debit but before the local add is recovered by
  retrying the same `requestId` (same authorization, no extra debit). See §11.

CORS: extend the existing origin allowlist in `server/index.js` to cover the
billing routes (same gating as auth/saves). The **webhook** is exempt from the
browser CORS allowlist (it's a server-to-server call from Stripe) but is protected
by **signature verification** instead.

Secrets (new env vars, same `.env` pattern): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, optionally `STRIPE_PUBLISHABLE_KEY` (client). Gems/billing
are **off unless these are set** (parallels "auth is off until `JWT_SECRET` is set"
— `[[accounts-auth-ops]]`). `buyEnabled:false` when keys are absent.

---

## 8. Purchase flow (Stripe Checkout)

Hosted Stripe Checkout — no card data ever reaches our server (PCI scope ≈ zero).

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
        │   redirect / open Checkout (Stripe-hosted page)  │                      │
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

The success page **does not credit**; it polls `/billing/wallet` (or shows
"processing…") until the webhook lands, then reflects the new balance. Typical
webhook latency is a second or two; show a spinner, not a number, until confirmed.

---

## 9. Refunds, chargebacks, disputes

- A Stripe **refund** or **chargeback** fires `charge.refunded` /
  `charge.dispute.*` webhooks. We handle them by writing a **negative compensating
  ledger row** (`kind:'refund'|'chargeback'`) for the gem value of that purchase and
  decrementing `gem_wallets.gems` — which **may drive the balance negative** if the
  player already converted/spent the gems. That's intended: a negative balance is a
  debt that future credits (purchases) net against; the player simply can't convert
  again until it's clear. (Coins already spent are not clawed back — they're a sunk
  client-side asset.)
- Never delete or mutate the original purchase row; the refund is its own row. The
  ledger stays append-only and auditable.
- Decide a policy for repeat chargebackers (e.g. block future purchases). Out of
  scope to *build* now; the ledger makes it detectable later.

---

## 10. Client UX

All DOM, per the project rule (no canvas UI). Lives with the account feature.

- **Entry point:** a new **"Gems / Store"** view inside `js/accountPanel.js`'s
  view set (alongside `signin/register/forgot/reset/account`), reachable from the
  `account` view by a **"Gems"** button. Only meaningful when signed in; if a
  signed-out user taps it from the menu, route them to sign-in first.
- **Wallet view shows:** current gem balance, a **"Buy gems"** section (web only —
  the pack cards → `/billing/checkout`), a **gems→coins converter** (slider/stepper:
  "Convert N gems → N×10 coins", with a "this can't be undone" note), and a
  **transaction history** list from `/billing/ledger` (date, type, amount, +/–).
- **New game wording:** the **"New game (wipe save)"** button stays a plain
  `localStorage.clear()` + reload (no gem reconciliation — there is no coins→gems).
  Its confirm copy should mention that **unspent coins are lost on a wipe, but gems
  are safe on your account** — so a player who over-converted understands gems
  weren't touched. No network call in this path; it stays offline-safe.
- **Live updates:** reuse `onWalletChange` (coins) and add an analogous
  `onGemsChange` notifier (a small `js/gems.js` client module holding the cached gem
  balance + subscribers, mirroring `wallet.js`/`accountSession.js`). The menu/HUD can
  show gems if we ever want to, but **no HUD gem chip in v1** — gems are an
  account-screen concept, not a moment-to-moment gameplay number.
- **Offline reads:** cache the last-known gem balance in the account session so the
  panel can show a (possibly stale) number offline, clearly without the Buy/Convert
  actions enabled.

New client files (one feature, one file):

| File | Responsibility |
|---|---|
| `js/gems.js` | Cached gem balance + `getGems()/onGemsChange()/refreshGems()`; talks to `/billing/wallet`. Mirrors `wallet.js`. |
| `js/billingApi.js` | Thin fetch wrappers for the `/billing/*` endpoints (mirrors `accountApi.js`). |
| `js/gemStorePanel.js` (or a view inside `accountPanel.js`) | The Gems/Store DOM view: balance, pack cards, gems→coins converter, ledger list. |

Server: `server/billingRoutes.js`, `server/gemPacks.js`, plus db helpers in
`server/db.js` and Stripe glue in e.g. `server/stripe.js`.

---

## 11. Edge cases & ordering

- **Convert ordering (no double-spend).** The server debits gems and returns;
  **only on a 200** does the client `addCoins(+coinsCredited)`. If the client crashes
  after the server debited but before it added coins, the player would have lost
  coins they paid gems for — so `/convert` is **idempotent on a client-generated
  `requestId`**: a retry returns the same authorization without a second debit, and
  the client adds the coins on the (possibly retried) success. Net: at most one
  debit, at most one matching coin credit.
- **Multi-device gems.** Gems are server-authoritative, so two devices see the same
  balance after a refresh. Two simultaneous gems→coins on two devices are serialized
  by the row-locked debit — the second sees the reduced balance or fails. Coins,
  being per-save and cloud-synced, follow the existing newest-wins save model.
- **Co-op.** Gems are per account and not co-op-aware. Converting gems→coins credits
  the *local* coin wallet (which in local split-screen folds onto P1, per
  `wallet.js`). `[[creative-mode-singleplayer-only]]` and the TD/PvP coin gates are
  unchanged — gems never appear in those modes.
- **Signed-out players** never have gems (no account). The store view tells them to
  sign in. Coins work exactly as today.
- **Account deletion** wipes the gem wallet; ledger retention is a policy question
  (§6).

---

## 12. Security & anti-abuse (summary)

- Gem amounts and pack prices are **server-authoritative**; the client sends only a
  `packId`. Never trust a client-sent gem count or price.
- Purchases credit **only** via signature-verified webhooks, **idempotent** on the
  provider event id. The browser success redirect credits nothing.
- No coins→gems path exists, so there is no client-trusted gem-minting input to
  defend (the historical central abuse surface — see §5.3 — is designed out).
- Rate-limit `/billing/checkout`, `/billing/convert`, and `/billing/webhook`
  (the webhook by Stripe signature + replay window).
- Card data never reaches us (hosted Checkout). PCI scope minimized.
- Secrets via env (`STRIPE_*`); billing **off** unless configured.

---

## 13. Testing

- **Unit** (`tests/`, pure node): ledger math (balance == sum of ledger),
  gems→coins (`gems × 10` credited, exact), atomic debit rejects when short (402),
  `requestId` idempotency (a retried convert debits once), webhook idempotency (same
  event id credits once), refund drives balance negative correctly. The db helpers
  run against a `:memory:` SQLite db exactly like the existing `db.js` tests.
- **Webhook**: replay a captured `checkout.session.completed` fixture twice → one
  credit. Replay `charge.refunded` → one debit.
- **E2E** (`tests/e2e/`): the convert flow against a running server with Stripe in
  **test mode** (Stripe test keys + the Stripe CLI to forward webhooks), behind an
  env guard so CI without keys self-skips (same pattern as the Chrome-absent skip).
- **Manual**: Stripe test cards through real Checkout in test mode end to end.

---

## 14. Open questions

Resolved 2026-06-09 (see header): platform scope (web/Stripe only), conversion
direction (gems→coins one-way), and rate (1 gem = 10 coins). Still open:

1. **Pack lineup & prices.** How many packs, what gem amounts, what EUR price points,
   and any "+X% bonus" tiers on bigger packs? Single currency to start, or Stripe
   multi-currency Prices from day one? (Drives §6 catalog.) Sanity check at 1 gem =
   10 coins: a shop priced in the hundreds–low-thousands of coins means a ~€5 pack
   probably wants to grant on the order of a few hundred to ~1,000 gems — tune once
   the shop's coin prices are settled.
2. **Ledger retention on account deletion.** Keep transaction rows (anonymized /
   tombstoned) for financial/refund audit, or hard-delete with the account? (§6)
3. **Refund/chargeback policy.** Confirm negative-balance clawback is acceptable, and
   whether repeat chargebackers get blocked from future purchases. (§9)
4. **Legal/compliance.** Terms of sale, EU consumer right-of-withdrawal for digital
   goods, VAT/tax handling (Stripe Tax?), age limits for purchases. Out of build
   scope but must be settled before charging real money.
5. **gems→coins minimum / granularity.** Any minimum conversion (e.g. ≥1 gem), or a
   confirm step on large conversions, since it's irreversible? Pure UX, low stakes.
```
