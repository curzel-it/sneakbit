# Ammo drops (kunai)

Status: **implemented** · Owner: Federico · Last updated: 2026-06-08

> Sibling to [procedural monsters](procedural-monster-spawning.md). Replaces the
> hand-scattered single-kunai filler with ammo that **drops** from monsters and
> barrels — reusing the coin-drop machinery — while the ×10 bundles stay as the
> occasional authored pickup and shops remain the backstop.

## Why

Single kunai pickups (`species_id` 7000, +1 each) were hand-placed filler: ~124 of
them dotted across the combat zones — static and tedious to author. Drops make ammo
dynamic, gated behind player action, and weapon-relevant, riding code that already
exists (`coinDrops.js`). Because **ammo is buyable in shops**, no drop tuning can
softlock a player, so drops stay modest.

## What ships

- **One mutually-exclusive loot roll per death** (`js/lootDrops.js`) decides
  *nothing / coins / ammo* — a kill never yields both coins and ammo:
  - **Monsters:** 40% nothing · 40% coins · 20% ammo
  - **Barrels:** 60% nothing · 30% coins · 10% ammo (barrels are ~10× denser than
    the kunai budget, so their ammo share is lower)
- **Amounts.** Coins keep their tier-scaled per-species `coin_drop_amount`; monster
  ammo = **½ the species coin amount, floored at 1** (so it scales with tier through
  fusion); barrel ammo = **1**.
- **Weapon-aware type.** Ammo is drawn only from ranged weapons the **killer** owns,
  weighted **kunai (7000) > AR-15/.223 (1169) > cannon (1170)**; defaults to kunai
  (everyone owns the launcher) when ownership is unknown. Never drops ammo you can't
  fire.
- **Data prune.** Single kunai (7000) removed from the 12 combat zones that carried
  them; the **×10 bundles (7001) stay** as the curated occasional pickup. Towns
  untouched.

Out of scope: a real AR-15/cannon economy (only drop-type *weighting* here); the 1099
arena loadout (authored test data); barrels as new *placement*; weapon pickups.

## How it works

`combat.js` (where a kill resolves) calls `maybeDropLoot(zone, target, killerIndex)`
in place of the old `maybeDropCoin`. The killer index comes from the killing bullet's
`_playerIndex`, so melee and ranged kills both attribute correctly.

- **`js/lootDrops.js`** — the gate. `rollLootCategory(species, rng)` →
  `"nothing" | "coin" | "ammo"` (monsters/barrels use different odds; only
  `CloseCombatMonster` and explosive barrels drop). `maybeDropLoot` dispatches to
  coins or ammo. No-op in Tower Defense / PvP / creative.
- **`js/ammoDrops.js`** — the ammo case: `ammoDropAmount`, `pickAmmoType`
  (weapon-aware, via `weaponsInSlot` in `js/weaponSlots.js`), `dropAmmo`, and
  `makeAmmoDrop`. Drops are ephemeral pickups (`_ephemeral`, own `−8,000,000` id
  band) scattered around the corpse with the shared `scatterPickups` helper.
- **`js/coinDrops.js`** — `scatterPickups` (the scatter loop, now shared) and
  `dropCoins` (forced coin scatter) were factored out; `rollCoinDrop`,
  `maybeDropCoin`, `coinRenderOffset`, `COIN_SPECIES_ID` are unchanged.

Pickup is the existing path: dropped rounds are resting `Bullet` entities, and
`pickups.js` already auto-collects `Bullet`/`Bundle` types, crediting `+1` per round
via `inventory.addAmmo`. Ephemeral, so never persisted — exactly like coins. The host
rolls the drop (host-authoritative) and the spawned pickups reach guests through the
normal entity snapshot.

## Economy

Target was **rough combined parity** with today's kunai availability, achieved with
flat global rates rather than per-zone tuning (simpler; the shop backstop makes a zone
running a little rich or lean harmless). Monster drops are a **renewable trickle**
(they respawn with the monsters); barrels (authored, persist-destroyed) and the kept
bundles are the **one-time** budget. The four barrel-free berry zones
(1002 / 1010 / 1017 / 1018) run entirely on monster drops.

## Tests

`tests/ammoDrops.test.js` — the gate splits (monsters 40/40/20, barrels 60/30/10),
coin/ammo mutual exclusivity, drop amount (½-coin floored at 1; barrels 1),
weapon-aware type (only owned weapons; kunai default; cannon never without its
weapon), and the scatter (ephemeral, correct id band). DOM-free, deterministic via an
injected rng.

## Open questions

- **Co-op drop type.** Type keys off the killer's loadout; host-authoritative. For a
  network guest's kill the host can't see the guest's owned weapons, so it falls back
  to kunai — acceptable (the staple), revisit if guests commonly carry AR-15/cannon.
- **Barrel weapon weighting.** Barrels use the same kunai>AR-15>cannon weighting as
  monsters (keyed off the breaker's loadout).
