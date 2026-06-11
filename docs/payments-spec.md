# Real-money store — implementation spec

Selling items for real money via **Stripe**, to help sustain development. This document
is the single source of truth for the feature. It is grounded in the current codebase
(account system, SQLite server, DOM shop) — earlier economy docs (the deleted
`gem-economy-spec.md`, the coin-only `coin-economy.md`) are **not** inputs here.

## Locked decisions

| Decision | Choice | Consequence |
| --- | --- | --- |
| Payment processor | **Stripe**, hosted Checkout | Cards + Apple/Google Pay + Link + local methods, near-zero PCI burden (SAQ-A) |
| Stripe integration | **Official `stripe` Node SDK, server-side only** | First runtime dependency in `server/`. The browser stays library-free (hosted Checkout = a redirect, no Stripe.js). |
| Launch catalog | **Cosmetic skins only** | Durable, one-time, "owned forever" semantics are clean. Model is generic so weapons/skills/packs can be added later. |
| Platforms | **Web only** (`sneakbit.curzel.it`) — for now | Native iOS/Android/Steam builds each mandate their own store IAP and come **much later down the line**; until then real-money tiles are hidden in those builds via `isWebStoreEnabled()`. |
| Currencies | **USD, EUR, GBP, JPY** | Prices authored per currency in a server catalog. |
| Currency selection | **Auto-detect from locale, with a manual override** | Picker in the shop; default from `navigator.language` / Stripe geo. |
| Tax handling | **Tax-inclusive prices** (`tax_behavior: "inclusive"`) | The catalog number **is** the final total the player pays, in every region. Stripe Tax backs the VAT/JCT out of that fixed total rather than adding it on top — so the displayed price needs **no runtime Stripe call** and never drifts from the charge. Net revenue varies by region (the gross is pinned); that's the accepted cost of honest, round consumer prices. |
| Eligibility | **Signed-in users only** | Entitlements are account-bound and server-authoritative. |
| Lifetime | **Forever, except refunds/disputes** | Revocable on Stripe refund/chargeback webhooks. |

## Non-negotiable correctness rules

These are the parts that are easy to get wrong and expensive when you do:

1. **The webhook is the source of truth — never the success redirect.** Entitlements are
   granted server-side on the signature-verified `checkout.session.completed` event. The
   browser returning to the success URL only *triggers a re-fetch*; anyone can navigate to
   that URL without paying.
2. **Prices live on the server.** The client only displays a price. The server builds the
   Checkout Session from its own catalog / Stripe Price objects. A client-sent amount is
   never trusted.
3. **The buyer is pinned from the auth token, not the request body.** `client_reference_id`
   and `metadata.userId` come from the bearer-authenticated user, so nobody can buy "for"
   another account. Only the `sku` (and chosen currency) come from the body, and both are
   validated against the catalog.
4. **Grants are idempotent and webhooks are de-duplicated.** Stripe re-delivers events;
   replays must grant exactly once.
5. **Entitlements are revocable.** "Forever" is the happy path; refunds and chargebacks flip
   the entitlement to `revoked` and the game removes it on next reconcile.
6. **The webhook needs the raw request body.** Signature verification runs over the exact
   bytes Stripe sent — not a re-serialized JSON object.

---

## How this fits the existing code

The codebase is already shaped for account-bound purchases. Nothing below fights the grain.

**Accounts & identity (reused as-is)**
- `server/db.js` — `node:sqlite` (`DatabaseSync`) at `./data.db` (or `$DATABASE_PATH`); idempotent
  `CREATE TABLE IF NOT EXISTS` migrations; query helpers per table. Users keyed by
  `id = "usr_" + 12 random hex bytes`.
- `server/authRoutes.js` / `server/bearerAuth.js` — `authenticateUser(req, {db, secret})`
  returns the user row for a valid `Authorization: Bearer <jwt>`. Reuse verbatim to gate the
  checkout and entitlements endpoints.
- `js/accountSession.js` — client session in `localStorage["sneakbit.account.v1"] = {token, user}`;
  exposes `getToken()`, `isSignedIn()`, `onAccountChange()`, and the `captureSession()` /
  `restoreSession()` pair that already keeps the account alive across **New Game** /
  **Clear Cache** (commit `ba7c3871`). Entitlements piggyback on that "a wipe resets progress,
  not identity" guarantee.
- `js/apiBase.js` `pickApiBase()` — dev `http://localhost:8090`, prod `https://sneakbit.curzel.it`.

**Server conventions to mirror**
- One feature one file, ES modules, zero-config `node:http` dispatch in `server/index.js`.
- Outbound HTTP via native `fetch` (`server/email.js` calls SMTP2GO this way) — but for Stripe
  we use the SDK instead (locked decision).
- Secrets read from `process.env`; strong-secret assertions at startup (`jwt.js`
  `assertStrongSecret`). Missing secret ⇒ feature gracefully **disabled** (auth returns 503
  when `JWT_SECRET` is unset — payments mirror this when `STRIPE_SECRET_KEY` is unset).
- Body parsing in `server/httpBody.js` `readJsonBody({maxBytes})` with `BODY_TOO_LARGE` /
  `BAD_JSON` codes. We add a sibling `readRawBody` for the webhook.
- Per-route rate limiting in `server/rateLimitHttp.js` (sliding window). Reuse for checkout.
- CORS + origin allowlist in `server/index.js` / `server/originAllowlist.js`. The webhook is
  server-to-server (Stripe), so it is **exempt** from the browser CORS path.

**Shop & skins (extended, not rewritten)**
- `js/shop.js` — DOM overlay; `openShop(stockList, playerIdx)`. Renders each `shop_stock`
  entry. Today the price label paints a coin icon next to `entry.price`.
- `js/shopPurchase.js` — pure coin logic: `canBuy`, `buy`, `isEntryOwned`, `maxAffordable`.
  **Stays coin-only.** Real-money entries branch *before* this, into a new file.
- `js/skins.js` — skin catalog + ownership. `isOwned`, `markOwned`, `getSelected`.
  Ownership stored at `player.{i}.skin.owned.{skinId}`; selection at `player.{i}.skin.selected`,
  and crucially **`getSelected()` already falls back to `default` when the selected skin is no
  longer owned** — so revoking a refunded skin auto-unequips it for free.
- Shop entry shapes today: `{ item, price, stackable? }` | `{ skin, price }` | `{ skill, price }`.
  We introduce one new shape: `{ sku }` (real money; price + identity come from the server
  catalog).

---

## Data model (server)

New tables in `server/db.js`, created by the existing `CREATE TABLE IF NOT EXISTS` migration
block — no manual migration step.

```sql
-- One row per (user, product). Grow-only, except status flips to 'revoked' on refund.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id     TEXT NOT NULL REFERENCES users(id),
  sku         TEXT NOT NULL,          -- catalog id, e.g. "skin.ninja_black"
  kind        TEXT NOT NULL,          -- "skin" today; "weapon"|"skill"|"pack" later
  ref_id      TEXT NOT NULL,          -- in-game id, e.g. "ninja_black"
  status      TEXT NOT NULL,          -- "active" | "revoked"
  source      TEXT NOT NULL,          -- "stripe"
  granted_at  INTEGER NOT NULL,       -- unix ms
  revoked_at  INTEGER,                -- unix ms, NULL while active
  PRIMARY KEY (user_id, sku)
);

-- Audit + the join Stripe refunds need (refund events carry a payment_intent, not a sku).
CREATE TABLE IF NOT EXISTS purchases (
  id                    TEXT PRIMARY KEY,   -- Stripe checkout session id (cs_...)
  user_id               TEXT NOT NULL REFERENCES users(id),
  sku                   TEXT NOT NULL,
  stripe_payment_intent TEXT,               -- pi_..., set when known
  amount                INTEGER NOT NULL,    -- smallest currency unit actually charged
  currency              TEXT NOT NULL,       -- "usd"|"eur"|"gbp"|"jpy"
  status                TEXT NOT NULL,       -- "paid" | "refunded"
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_pi ON purchases(stripe_payment_intent);

-- Webhook de-duplication. Insert-or-ignore; if the id already exists, ack and skip.
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,       -- evt_...
  type        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
```

New query helpers in `server/db.js` (consistent with the existing `createUser` / `getSave`
style): `grantEntitlement`, `revokeEntitlement`, `listActiveEntitlements(userId)`,
`hasActiveEntitlement(userId, sku)`, `recordPurchase`, `markPurchaseRefunded(paymentIntent)`,
`findPurchaseByPaymentIntent`, `recordStripeEvent(id, type)` (returns `false` if already seen).

`grantEntitlement` uses upsert so replays and re-purchase-after-refund are idempotent:

```sql
INSERT INTO entitlements (user_id, sku, kind, ref_id, status, source, granted_at, revoked_at)
VALUES (?, ?, ?, ?, 'active', 'stripe', ?, NULL)
ON CONFLICT(user_id, sku) DO UPDATE SET status='active', granted_at=excluded.granted_at, revoked_at=NULL;
```

---

## Server catalog (authoritative prices)

`server/storeCatalog.js` — the **only** place real-money prices and product identity live.
Each entry maps a `sku` to its in-game effect and its Stripe `Price`. Prices are stored in
the **smallest currency unit**, with zero-decimal currencies (JPY) handled explicitly. Because
pricing is **tax-inclusive** (locked decision), each amount is the **final gross total the player
pays** — the same number the shop displays and the same number Stripe charges.

```js
// Zero-decimal currencies: amount is the whole unit, not 1/100. (Stripe's list; we use JPY.)
export const ZERO_DECIMAL = new Set(["jpy"]);

export const CATALOG = [
  {
    sku: "skin.ninja_black",
    kind: "skin",
    refId: "ninja_black",          // must exist in js/skins.js SKINS
    nameKey: "skins.name.ninja_black",
    stripePrice: "price_XXXX",     // a Stripe Price carrying currency_options for all 4
    // final tax-inclusive gross, smallest unit per currency; usd/eur/gbp are cents, jpy is whole yen
    prices: { usd: 499, eur: 499, gbp: 449, jpy: 600 },
  },
  // ...one per real-money skin
];
```

Authoring rules:
- **Respect Stripe per-currency minimums** (~$0.50 USD equivalent; e.g. don't price below
  ~¥50 / £0.30 / €0.50). Charges below the minimum are rejected by Stripe.
- `refId` must resolve in `js/skins.js`. A unit test asserts this.
- A given skin is sold **either** for coins **or** for real money — never both. (Coin skins keep
  their `{ skin, price }` entry; real-money skins use `{ sku }` and do not appear as coin entries.)
- The four `prices` are simultaneously the **displayed** price and the **charged** price — with
  tax-inclusive Stripe Prices these are the same number by construction. The setup script reads the
  `currency_options` back from Stripe and a unit test asserts **exact equality** with the catalog
  (no fuzzy "keep in sync" — display gross *is* charged gross).

**Stripe object setup (one-time, via dashboard or a `tools/stripeSetup.mjs` script):** create one
**Product** per skin and one **Price** per product with `currency_options` for usd/eur/gbp/jpy, and
set **`tax_behavior: "inclusive"`** on the Price (so the amounts above are the gross totals; Stripe
extracts the tax from them rather than adding it). Store the returned `price_…` id in `stripePrice`.
Using `currency_options` means a single Price serves all four currencies; the Checkout Session's
`currency` selects which option is charged.

---

## Server endpoints (new)

New files, one feature each:
- `server/stripe.js` — lazily constructs the Stripe SDK client from `STRIPE_SECRET_KEY`;
  exports `getStripe()` (or `null` when unconfigured) and `isPaymentsEnabled()`.
- `server/storeCatalog.js` — the catalog above + lookups (`findSku`, `displayCatalog`).
- `server/paymentsRoutes.js` — `createPaymentsHandler({ db, secret, env })`; the three
  browser-facing routes below.
- `server/stripeWebhook.js` — `createStripeWebhookHandler({ db, env })`; the webhook route.

Wire them into `server/index.js`'s dispatcher next to `/auth`, `/saves`, `/editing`. The three
`/store/*` routes join the **auth-scoped CORS group** (origin-gated, `authorization` header
allowed). `/webhooks/stripe` is registered **outside** that group (no CORS, no bearer).

### `GET /store/catalog`  (no auth)
Returns the displayable catalog so the shop can render prices before sign-in.
```json
{ "items": [
  { "sku": "skin.ninja_black", "kind": "skin", "refId": "ninja_black",
    "nameKey": "skins.name.ninja_black",
    "prices": { "usd": 499, "eur": 499, "gbp": 449, "jpy": 600 } }
] }
```
Returns `503 {"error":"payments_disabled"}` when `STRIPE_SECRET_KEY` is unset.

### `POST /store/checkout`  (bearer)
Body: `{ "sku": "skin.ninja_black", "currency": "eur" }`.
Server logic:
1. `authenticateUser` → `user`. (401 if not signed in.)
2. Rate-limit per user/IP (reuse `rateLimitHttp`).
3. Validate `sku ∈ catalog` and `currency ∈ {usd,eur,gbp,jpy}` (else 400).
4. If `hasActiveEntitlement(user.id, sku)` → `409 {"error":"already_owned"}`.
5. Create a Stripe Checkout Session:
   ```js
   stripe.checkout.sessions.create({
     mode: "payment",
     currency,                                   // selects the currency_option
     line_items: [{ price: item.stripePrice, quantity: 1 }],
     client_reference_id: user.id,               // pinned from the token, not the body
     metadata: { userId: user.id, sku: item.sku },
     customer_email: user.email,
     success_url: `${APP_BASE_URL}/?purchase=success&sku=${sku}`,
     cancel_url:  `${APP_BASE_URL}/?purchase=cancel`,
     automatic_tax: { enabled: true },           // remits the tax embedded in the inclusive price
   })
   ```
6. Return `{ "url": session.url }`.

### `GET /store/entitlements`  (bearer)
Returns the signed-in user's active entitlements for the client to reconcile:
```json
{ "entitlements": [ { "sku": "skin.ninja_black", "kind": "skin", "refId": "ninja_black", "grantedAt": 1718000000000 } ] }
```

### `POST /webhooks/stripe`  (no auth, signature-verified)
- Read the **raw body** via the new `readRawBody(req, { maxBytes: 1MB })` in `server/httpBody.js`
  (returns a `Buffer`, no `JSON.parse`).
- `event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET)`.
  On failure → `400` (do not process).
- `recordStripeEvent(event.id, event.type)`; if it returns "already seen", ack `200` and stop.
- Dispatch:
  - **`checkout.session.completed`** (and `checkout.session.async_payment_succeeded`):
    require `session.payment_status === "paid"`; read `metadata.userId` + `metadata.sku`;
    look up the catalog entry for `kind`/`refId`; `recordPurchase(session)`;
    `grantEntitlement(userId, sku, kind, refId)`.
  - **`charge.refunded`** / **`charge.dispute.created`**: resolve the `payment_intent`,
    `findPurchaseByPaymentIntent` → `markPurchaseRefunded` + `revokeEntitlement(userId, sku)`.
- Always ack `200` once handled (so Stripe stops retrying), `4xx` only on signature/parse failure.

**Configure in the Stripe dashboard:** endpoint `https://sneakbit.curzel.it/webhooks/stripe`,
subscribed to `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`charge.refunded`, `charge.dispute.created`.

---

## Client (browser)

The browser never loads Stripe.js — hosted Checkout is just a redirect. New files, one feature
each (UI stays out of the canvas per project rules):

- `js/storeApi.js` — thin `fetch` wrappers returning the normalized `{ ok, status, data, error,
  offline }` shape used by `js/accountApi.js`: `fetchCatalog()`, `createCheckout(token, {sku, currency})`,
  `fetchEntitlements(token)`.
- `js/storeCurrency.js` — currency selection. `getCurrency()` resolves: stored override
  (`sneakbit.settings.v1.store.currency`) → else map `navigator.language`/region to one of the four
  → else `usd`. `setCurrency(c)` persists the override. `format(amount, currency)` uses
  `Intl.NumberFormat(locale, { style: "currency", currency })`, dividing by 100 **only** for
  non-zero-decimal currencies.
- `js/entitlements.js` — the client mirror of server entitlements. `reconcile(token)` calls
  `GET /store/entitlements`, then:
  - for each active **skin** entitlement → `skins.markOwned(refId)` and record it in a local
    entitled-set cache `sneakbit.kv.v1.store.entitled.skins`;
  - for each skin previously in the entitled-set but **no longer active** (a refund) → clear its
    `player.{i}.skin.owned.{refId}` flag and drop it from the cache. `js/skins.js`
    `getSelected()` then auto-reverts a now-unowned equipped skin to `default`.
  - Coin-bought skins are never touched (the diff only ever adds/removes skins that came through
    the entitled-set). Mirrors how `js/cloudSave.js` reconciles.
  `reconcile` runs on boot when signed-in, on `onAccountChange` sign-in, and after a checkout
  return.
- `js/realMoneyShop.js` — the buy action for `{ sku }` entries: if not signed in →
  `openAccountPanel("signin")`; else `createCheckout(getToken(), { sku, currency })` →
  `location.assign(url)` (top-level redirect to Stripe).
- `js/buildTarget.js` — `isWebStoreEnabled()` (default `true`; native packaging sets it `false`).
  Gates whether `{ sku }` entries render at all.

**Shop rendering (`js/shop.js`, extended):** when an entry has a `sku`, branch to a real-money
tile instead of the coin tile:
- hidden entirely if `!isWebStoreEnabled()`;
- price label = `storeCurrency.format(catalogPrice, getCurrency())` plus a small currency picker;
- state: **Owned** if entitled (read from the entitled-set / `skins.isOwned(refId)`);
  **"Sign in to buy"** if logged out; otherwise the price button → `realMoneyShop` checkout.

`js/shopPurchase.js` is untouched. Real-money entries never reach `canBuy`/`buy`.

**Return handling (`index.html` boot, alongside the existing `?reset=` handling in
`js/accountPanel.js`):** on `?purchase=success`, call `entitlements.reconcile(token)`, show a
confirmation toast, and strip the query param. Because the webhook may land a beat after the
redirect, reconcile **retries a few times with backoff** (e.g. 3 attempts over ~6 s) before
giving up with a "your purchase is being processed — it'll appear shortly" message. On
`?purchase=cancel`, just strip the param (no error).

**Example shop stock entry** (a zone `shop_stock` array or `js/prefabs.js` default):
```json
{ "sku": "skin.ninja_black" }
```

---

## End-to-end flow

```
Player (signed in, web build)
  └─ Shop shows "Ninja (black)  €4.99  [Buy]"        ← /store/catalog + chosen currency
        │ click Buy
        ▼
  POST /store/checkout {sku, currency}  (Bearer)     ← server validates, pins userId from token
        │ {url}
        ▼
  location.assign(url)  →  checkout.stripe.com        ← card / Apple Pay / Google Pay / Link
        │ pays
        ▼
  Stripe ──► POST /webhooks/stripe  checkout.session.completed
        │      verify sig (raw body) → dedupe → record purchase → grant entitlement   ★ source of truth
        ▼
  Stripe redirects → /?purchase=success&sku=...
        │ client: reconcile entitlements (retry until webhook lands) → skin marked Owned → toast
        ▼
  Skin equippable from the inventory Skin slot. Account-bound: survives New Game / Clear Cache
  because the account survives and boot-time reconcile re-applies the entitlement.
```

Refund path:
```
Refund/chargeback in Stripe ──► charge.refunded / charge.dispute.created
   → server: find purchase by payment_intent → mark refunded → revoke entitlement
   → next client reconcile: clear local owned flag → getSelected() reverts to default if it was equipped
```

---

## Security checklist

- [ ] Webhook signature verified over the **raw** body; reject (`400`) otherwise.
- [ ] `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` read from env; payments **disabled (503)**
      when `STRIPE_SECRET_KEY` is missing (mirrors `JWT_SECRET` handling).
- [ ] Checkout + entitlements endpoints behind `authenticateUser` (bearer).
- [ ] `userId` taken from the token, never the request body; `sku`/`currency` validated against
      the catalog.
- [ ] Amounts come from the Stripe `Price` / server catalog, never the client.
- [ ] Webhook events de-duplicated via `stripe_events`; grants idempotent via upsert.
- [ ] `session.payment_status === "paid"` checked before granting; async methods handled via
      `async_payment_succeeded`.
- [ ] Rate-limit `POST /store/checkout` (reuse `server/rateLimitHttp.js`).
- [ ] No secrets logged. Stripe holds card data (PCI **SAQ-A** with hosted Checkout).

---

## Tax & compliance (business setup, flagged — not legal advice)

- **Tax-inclusive display, the easy way.** Prices are authored **tax-inclusive** (`tax_behavior:
  "inclusive"` on each Stripe Price), so the catalog number is the final total a player pays in
  every region — no runtime Stripe call to render it, and it satisfies the EU/UK expectation that
  consumers see tax-inclusive prices up front. Stripe Tax still computes and remits the embedded
  VAT/JCT; it just backs it out of the fixed total instead of adding to it. Net revenue therefore
  varies by region (the gross is pinned) — the accepted cost of round, honest consumer prices.
- **VAT / UK VAT / JP consumption tax** apply when selling digital goods to consumers in those
  regions. **Stripe Tax** (`automatic_tax: { enabled: true }` on the session) handles calculation +
  collection; assess registration thresholds with an accountant.
- Publish a **refund policy** and **terms of service**; link them from the shop. For EU digital
  goods, the 14-day withdrawal right can be waived with explicit consent at purchase — Stripe
  Checkout can surface the consent/terms.
- **SCA / 3-D Secure** is handled automatically by hosted Checkout.
- A user-facing **refund request path** (email is fine to start) — the `charge.refunded` webhook
  then revokes the entitlement automatically.

---

## Testing

**Unit (`tests/*.test.js`, node runner, no deps):**
- Catalog integrity: every `sku` has a valid `kind`/`refId` (skin `refId` exists in
  `js/skins.js`), prices ≥ Stripe minimums, zero-decimal handling correct, and each catalog
  amount **exactly equals** the matching `currency_options` amount read back from Stripe (display
  gross == charged gross; the Prices are `tax_behavior: "inclusive"`).
- Currency formatting: `storeCurrency.format` — cents vs whole-yen, locale rendering.
- Entitlement reconcile diff: grant adds ownership; revoke removes **only** entitlement-owned
  skins and reverts an equipped revoked skin to default; coin-owned skins untouched.
- Webhook handler: build a signed test event with the SDK
  (`stripe.webhooks.generateTestHeaderString`) against a known secret; assert grant on
  `checkout.session.completed`, revoke on `charge.refunded`, and that a **replayed** event grants
  exactly once (dedup).

**E2E / manual (`tests/e2e/*.mjs` + Stripe test mode):**
- Real card flows can't run in CI; use Stripe **test mode** with test cards (`4242…`).
- Local webhook delivery: `stripe listen --forward-to localhost:8090/webhooks/stripe` and
  `stripe trigger checkout.session.completed`.
- Optional e2e that stubs `POST /store/checkout` to a fake success and asserts the shop tile
  flips to **Owned** after reconcile.

---

## Deploy & ops

- **New server dependency:** add `stripe` to `server/package.json`. The deploy
  (`tools/deploy.mjs`) must now run `npm install --omit=dev` (or `npm ci`) in `server/` on the
  VPS — previously the server had zero deps, so confirm the deploy step installs them.
- **New env vars** on the VPS (`.env` / systemd `sneakbit-server`): `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`. (`APP_BASE_URL` already defaults to `https://sneakbit.curzel.it`.)
  Start in **test mode** (`sk_test_…` + the test webhook signing secret), then switch to live.
- **DB migration:** the new tables are created by `CREATE TABLE IF NOT EXISTS` on next boot — no
  manual step.
- **nginx:** the `/webhooks/stripe` location must proxy the request body through **unmodified**
  (default for proxied POST). Don't add any body-rewriting there, or signature verification fails.
- **Stripe dashboard:** create Products/Prices (record `price_…` ids in the catalog), add the
  webhook endpoint + event subscriptions, enable the desired payment methods (cards + wallets +
  Link to start) and Stripe Tax.

---

## Build order

- **Phase 0 — Stripe setup.** Account, Products/Prices (with `currency_options` and
  `tax_behavior: "inclusive"`), Stripe Tax enabled, test keys, webhook endpoint, tax-registration
  assessment, refund/ToS copy.
- **Phase 1 — Server.** `db.js` tables + helpers; `stripe.js`; `storeCatalog.js`;
  `paymentsRoutes.js` (catalog / checkout / entitlements); `stripeWebhook.js` + `readRawBody`;
  env wiring + graceful 503 disable; unit tests. Ship behind the disabled state (no keys = inert).
- **Phase 2 — Client (happy path).** `storeApi.js`, `storeCurrency.js`, `entitlements.js`,
  `realMoneyShop.js`, `buildTarget.js`; shop render branch for `{ sku }`; success/cancel return
  handling; web-only gating; "sign in to buy" gate.
- **Phase 3 — Refund/revoke.** End-to-end revoke + reconcile removal + equipped-skin revert.
- **Phase 4 — Polish.** Currency picker UI, localized formatting, toasts, declined/canceled
  states, Stripe Tax enablement.
- **Phase 5 — Go live.** QA in test mode, rotate to live keys + live webhook secret, deploy.

---

## Explicitly out of scope (and why)

- **Consumables / a spendable gem balance for real money** — a balance consumed on use doesn't fit
  "owned forever". If wanted later, model it as a separate account-scoped balance, not an entitlement.
- **Native IAP (iOS/Android/Steam)** — coming **much later down the line**; each store mandates its
  own purchase API, so real-money tiles stay hidden in those builds via `isWebStoreEnabled()` until
  then. Web (`sneakbit.curzel.it`) is the only channel for this launch.
- **Permanent unlocks (weapons/skills), supporter packs, gifting, coupons/sales, regional
  overrides beyond the four currencies** — all additive on the generic `kind`/`refId` entitlement
  model; not part of the first launch.
</content>
</invoke>
