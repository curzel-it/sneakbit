# Account entitlements — durable weapons & skins

Status: **draft for review** · Date: 2026-06-09

> **Product decisions locked (2026-06-09):** **all** one-of-a-kind weapons carry
> (NG+ style) and **all** non-default skins carry; entitlements are
> **server-authoritative** (logged-in only); the **selected skin is account-bound**;
> on a new game carried weapons are **not** auto-equipped (the save starts at default
> weapons, the player cycles). The doc below reflects these.

A sibling to the [gem economy](gem-economy-spec.md): some things a player acquires
should belong to their **account**, not to a single save. Find a sword while signed
in and it's *yours* — start a new game and you still have it. Same for a purchased
AR-15, and for any skin. Ammo (kunai, bullets, bundles) is **not** included — it's
consumable and stays per-save.

This is a design spec to implement later. Nothing here is built yet.

---

## 1. Intent

Today everything a player owns lives in the per-save namespace `sneakbit.kv.v1.*`
(via `storage.js`): inventory item counts (`player.{i}.inventory.amount.{sid}`),
equipped weapons (`player.{i}.equipped.{slot}`), skin ownership
(`player.{i}.skin.owned.{skinId}`) and skin selection (`player.{i}.skin.selected`).
That namespace is the cloud-save blob (`saveBlob.js`) — it syncs across devices, but
**a "New game (wipe save)" does `localStorage.clear()` and also deletes the cloud
save**, so all of it is gone on a fresh start. That's correct for *progress*; it's
wrong for *things you earned or bought*.

We add a small, **account-scoped, durable set of entitlements** — owned weapons and
skins — that survives a new game and re-seeds every fresh save while you're signed
in. Logged-out play is unchanged.

The enabling fact (verified in code): **weapon "ownership" is not a flag** — a
weapon is owned iff the player holds ≥1 of its *item* in inventory
(`weaponSlots.js`, `shopPurchase.js`). So "the account owns the sword" just means
"re-grant the sword item into each fresh save." Skin ownership is a literal
`player.{i}.skin.owned.{id}` key we re-set the same way. **No change to the
ownership/derivation model is needed** — only a durable list of what to re-grant.

---

## 2. Goals & non-goals

**Goals**
- A signed-in player's **one-of-a-kind weapons** and **skins** persist across a new
  game and across devices, independent of the per-save cloud blob.
- Acquiring such an item (found in the world *or* bought) while signed in records it
  to the account. A new game (or a sign-in) grants the account's set into the save.
- Grow-only, conflict-free: you never *lose* an entitlement, so multi-device merge is
  a plain **union** — far simpler than the save blob's newest-wins.
- Logged-out behaviour is exactly as today (per-save, wiped by new game).

**Non-goals (this pass)**
- Ammo / consumables persistence. Kunai, bullets and bundles stay per-save.
- Coins (per-save) and gems (already account-bound — see the gem spec). Those are
  currencies; this is items.
- Cross-account trading/gifting of weapons or skins.
- Selling weapons/skins for **gems** directly (premium cosmetics). The data model
  leaves room for it (a `source` field) but it's a later milestone.
- Changing how weapons are owned/derived or how the shop marks "Owned". Those keep
  working unchanged because we re-grant the same inventory items.

---

## 3. What's account-bound

Two kinds:

### Weapons (one-of-a-kind items)
The weapon **items** (not the weapon species, not ammo). Verified ids in
`data/species.json`:

| Weapon | Item species (bound) | → grants weapon | Slot |
|---|---|---|---|
| Sword | `1164` | `1159` | melee |
| AR-15 | `1162` | `1154` | ranged |
| Cannon | `1168` | `1167` | ranged |
| Shield | `1172` | `1171` | melee |
| Darkblade | `1180` | `1179` | melee |
| Dark AR-15 | `1183` | `1182` | ranged |

> **Excluded:** the default kunai launcher (`1160`, no item — always available) and
> all ammo/bundles. Kunai-the-ammo is consumable; only the *launcher* is implicit
> and never needs re-granting.

### Skins
All non-default skins in `js/skins.js` (the 5 beyond `"default"`, identified by
their stable numeric `key`). `"default"` is always owned and never stored.

### Binding rule: default-on, opt-out
Every weapon **item** (any species with an `associated_weapon`) and every
non-default skin is account-bound. The set is derived, not hand-listed — so a new
weapon item or skin is durable automatically. As an escape hatch, a species may
carry **`"account_bound": false`** in `data/species.json` (or the `skins.js`
catalog) to opt a specific item *out* — e.g. if a future weapon is meant to be
re-earned every playthrough. Default is on; the flag is only ever needed to exclude.
(The server uses the same derived allowlist to validate `refId` — §6.)

---

## 4. Mental model

Account entitlements are a **durable grant-set re-applied to each fresh save**. The
per-save inventory remains the runtime source of truth for "do I own this *right
now*"; the account set is the record of "what I always start with."

```
  acquire (find / buy) while signed in
        │  add item to inventory (kv.v1, per-save, in cloud blob)   ── runtime ownership
        └▶ record to ACCOUNT ENTITLEMENTS (server, durable)         ── "always re-grant this"

  new game  ─ wipes kv.v1 + deletes cloud save (unchanged) ─▶ fresh, empty save
        └▶ on boot, signed in: grant account entitlements into the fresh save
              weapons → addAmmo(itemId, 1)   skins → markOwned(skinId)   selection restored

  sign in mid-playthrough ─▶ union account set into the current save (you "have" them)
```

Both directions converge on the same set, so they're idempotent and order-free.

---

## 5. Storage model

**Recommended: server-authoritative entitlements**, mirroring how gems work
(`server/db.js`, bearer-authenticated). The per-save cloud blob and the new-game
wipe stay **exactly as they are** — lowest regression risk — and entitlements are a
separate dataset new-game does *not* delete.

```sql
-- Grow-only set, one row per (user, item). Union-merge = INSERT OR IGNORE.
CREATE TABLE account_entitlements (
  user_id     TEXT    NOT NULL REFERENCES users(id),
  kind        TEXT    NOT NULL,   -- 'weapon' | 'skin'
  ref_id      INTEGER NOT NULL,   -- weapon ITEM species id, or skin numeric key
  source      TEXT,               -- 'found' | 'shop' | 'gem' (provenance; gem = uncheatable premium, later)
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id)
);

-- Account-level selected skin (a single mutable value, newest-wins — NOT grow-only).
-- A tiny per-user prefs row; could also hold future account-scoped cosmetics state.
CREATE TABLE account_prefs (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  selected_skin INTEGER,          -- skin numeric key, or NULL = default
  updated_at    INTEGER NOT NULL
);
```

`deleteUser` (account deletion) also clears both tables. No money is involved, so —
unlike the gem ledger — there's nothing to retain for audit; hard-delete is fine.

> **Why not just a durable local namespace?** An alternative is a new
> `sneakbit.acct.v1.*` localStorage namespace that the new-game wipe is taught to
> *skip*, synced to the account as its own blob. It gives offline durability (weapons
> survive even with no account) but (a) requires turning the blunt `localStorage.clear()`
> into a selective wipe — easy to get subtly wrong — and (b) still needs a new server
> endpoint to sync, since the per-save blob is deleted on new game. So it adds
> regression risk without removing the server work. The server-authoritative model is
> cleaner and naturally "logged-in only," matching the brief and the chosen
> server-authoritative model. (Offline durability for *logged-out* players is a
> possible later add-on, not part of this spec.)

Trust: entitlements aren't real money, and a cheater editing `localStorage` could
already grant themselves any weapon. So **`found`/`shop` entitlements are
client-asserted** (acceptable — same threat as today). Only future **`gem`-sourced
premium** entitlements would be granted server-side inside the purchase flow and
never client-asserted (that's why `source` exists).

---

## 6. Server API

New handler `server/entitlementsRoutes.js` (mirrors `savesRoutes.js` /
`billingRoutes.js`: `createEntitlementsHandler({ db, env })`, bearer-authenticated,
`503` when `JWT_SECRET` is unset).

| Method & path | Body | Returns |
|---|---|---|
| `GET /account/entitlements` | — | `{ weapons:[itemId…], skins:[key…], selectedSkin: key\|null }` |
| `POST /account/entitlements` | `{ kind, refId, source }` | `INSERT OR IGNORE`; returns the full updated set (idempotent union add) |
| `PUT /account/entitlements/selected-skin` | `{ skinKey }` | sets `account_prefs.selected_skin` (newest-wins); ignored unless that skin is owned |

- `POST` is **idempotent** (PK collision is a no-op) — safe to replay, which is what
  makes offline queueing trivial (§7).
- The server may **validate `refId`** against its derived allowlist (weapon items +
  non-default skins, minus any `account_bound:false`) so a malformed/garbage id can't
  pollute the set, but it does **not** verify the player legitimately found the item
  (can't, and needn't).
- CORS: same origin allowlist as auth/saves/billing in `server/index.js`.

---

## 7. Client

New modules (one feature, one file), mirroring `gems.js` / `accountSession.js`:

| File | Responsibility |
|---|---|
| `js/entitlements.js` | Cached account set + `getWeapons()/getSkins()/getSelectedSkin()`, `recordAcquired(kind, refId, source)`, `applyToSave()`, an offline queue, and sync on sign-in. |
| `js/entitlementsApi.js` | Thin fetch wrappers for `/account/entitlements*`. |

### Recording an acquisition (save → account)
When signed in, the existing grant chokepoints also call
`recordAcquired(kind, refId, source)`:
- **Weapons:** `js/pickups.js` `maybeEquipWeapon()` (found in world) and
  `js/shopPurchase.js` `grant()` (bought) — when the granted item carries
  `account_bound`, record `{kind:'weapon', refId:itemId}`.
- **Skins:** `js/skins.js` `markOwned()` — record `{kind:'skin', refId:key}`.
- **Selection:** `js/skins.js` `setSelected()` also `PUT …/selected-skin` (the active
  skin is account-bound).

Offline / signed-out: `recordAcquired` writes to a small local pending queue
(`sneakbit.ent.pending.v1`) and flushes on next sign-in / reconnect. Union semantics
make replay safe; nothing is lost.

### Granting the account set into a save (account → save)
`entitlements.applyToSave()` is **idempotent** and runs:
- On **boot when signed in** (after `seedStartingCoins`, `main.js`) — re-grants on
  every fresh save; on an existing save it's a no-op union (items already present).
- On **sign-in mid-playthrough** — unions the account's items into the current save.

It does, per entitlement:
- weapon → `addAmmo(itemId, 1, 0)` if the player holds 0 (so it never stacks
  endlessly), which makes the weapon owned + cyclable (per the inline weapon-cycle).
- skin → `markOwned(skinKey, 0)`.
- selection → `setSelected(accountSelectedSkin, 0)` if that skin is owned.

**Equip policy on grant:** do **not** auto-equip carried weapons. Leave the fresh
save at its defaults (melee = unarmed, ranged = kunai launcher) and let the player
cycle to an owned weapon. This avoids a difficulty spike from auto-equipping the
strongest carried weapon, and sidesteps "which of my 4 weapons gets equipped?"
ambiguity. (Contrast the *first-time* pickup/purchase, which still auto-equips — that
moment is an intentional reward; re-granting on a new save is not.)

### Reads when offline
Cache the last-known set alongside the account session so `applyToSave()` can run
from cache offline; a fresh sign-in on a brand-new device needs one online fetch
before its first grant (acceptable — you're signing in, you're online).

---

## 8. Logged-out & offline

- **Signed out:** no account, so nothing is durable — weapons and skins are per-save
  exactly as today, and a new game wipes them. The pending queue holds any
  acquisitions made while signed out and binds them on the next sign-in.
- **Signed in, offline:** acquisitions queue locally; `applyToSave()` runs from the
  cached set; everything syncs (union) on reconnect. Matches the offline-first stance
  of `[[accounts-auth-ops]]` — never block gameplay on the network.

---

## 9. Game-design considerations

- **Difficulty pacing (accepted).** NG+ is the chosen direction: every one-of-a-kind
  weapon carries, so a replay starts geared. This is intentional — early combat will
  be easier and weapons that are normally story/zone-gated rewards lose some of their
  reveal on subsequent playthroughs. If a *specific* weapon should stay a per-run
  reward, opt it out with `account_bound:false` (§3); otherwise all carry. Skins are
  cosmetic (no balance impact) and all carry.
- **Authored world pickups reappear.** A weapon you "find" is an authored pickup in
  some zone; the per-save `item_collected.{id}` flag that hides a collected pickup is
  wiped by new game, so the pickup is there again on replay. Harmless — you already
  own the weapon, re-collecting just no-ops the count. The account grant only means
  you *start* with it before reaching that zone.
- **No new HUD.** Entitlements surface through the systems that already exist — the
  weapon cycle, the shop's "Owned" state, the skin picker in the inventory screen.
  Nothing new to draw.

---

## 10. Edge cases

- **Co-op.** Entitlements are per *account* and apply to the **local** player
  (index 0 / the account holder). Local split-screen already folds P2→P1, so one set
  covers the shared slot. Network co-op: each client grants from its own account;
  guests' own accounts drive their own loadouts (consistent with how skins already
  sync per-session). Entitlements never appear in PvP/TD (no weapons economy there).
- **Multi-device.** Grow-only union means two devices simply OR their sets together;
  no conflict resolution. Selected-skin is newest-wins (single value).
- **Account deletion.** Clears `account_entitlements` + `account_prefs`. The local
  save is untouched (the player keeps whatever's in their current save until they
  wipe it).
- **Signing into a *different* account** on a device with progress: union that
  account's entitlements into the current save (you don't lose the local items; you
  gain the account's). Acquisitions then record to the now-signed-in account.

---

## 11. Testing

- **Unit** (`tests/`, pure node, `:memory:` db like `db.js` tests): `INSERT OR
  IGNORE` union (double-add is one row), `GET` shape, selected-skin newest-wins and
  the "must own it" guard, `applyToSave()` idempotency (running twice grants once),
  the `account_bound` filter (a non-bound item never records).
- **Client logic** kept DOM-free where possible: the pending-queue flush, the
  "grant only if count 0" rule. The `addAmmo`/`markOwned` grant paths are exercised by
  the existing inventory/skin tests' harness shape.
- **E2E** (`tests/e2e/`): sign in, acquire a bound weapon + a skin, hit New game,
  confirm the fresh save starts with both (and that the *selected* skin is restored),
  behind the usual auth-configured / Chrome-present skip guards.

---

## 12. Open questions

Resolved 2026-06-09 (see header): weapon scope (all, NG+), storage
(server-authoritative), skin selection (account-bound), equip-on-grant (defaults,
no auto-equip). Still open:

1. **Premium cosmetics (future).** Do we foresee selling skins/weapons for **gems**
   (real money)? If yes, those entitlements must be granted server-side in the gem
   flow (uncheatable) — the `source` field is already there for it, but worth
   confirming the direction so we don't paint it out.
2. **Any per-run exceptions?** With NG+ binding everything by default, are there
   specific weapons that should stay a per-playthrough reward (mark
   `account_bound:false`)? Can be decided later, per weapon, in data.
