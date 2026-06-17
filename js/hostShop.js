// Host-side handler for online guests' shop purchases.
//
// A guest runs the buy screen on its own client (its real wallet + inventory
// at index 0) — see guestEvents.handleShopOpen. Coins and equipment are
// guest-authoritative and persist on the guest's device. AMMO is not: the
// host owns each guest's authoritative pool at player.{slot-1}.inventory,
// which shooting.js spends and which ammoSet re-broadcasts. So the guest
// reports each grant over `shop.bought` and we mirror it into that pool here,
// then echo an absolute ammoSet back so the guest's HUD stays in lockstep even
// if an unrelated frame raced the purchase.
//
// Trust: a co-op guest is trusted at the same level as its forwarded loadout
// and movement (this is co-op, not PvP — PvP has no shop). We still bound each
// line and require a known species so a tampered client can't inject a wild
// pool. The relay applies a field whitelist on the WS path too (relay.js).

import { getNet, getNetRole } from "./onlineBootstrap.js";
import { addAmmo, getAmmo } from "./inventory.js";
import { getSpecies } from "./species.js";
import { broadcastHostEvent } from "./hostEvents.js";

let stateGetter = null;
let unsub = null;

// Per-line clamp on a self-reported purchase. The shop caps a single buy at
// MAX_PURCHASE_QTY (99) and bundles expand a few-fold, so a couple hundred is
// a generous ceiling that still bounds abuse.
const MAX_ITEM_AMOUNT = 200;

export function installHostShop(getState, opts = {}) {
  if (getNetRole() !== "host" && !opts.force) return false;
  uninstallHostShop();
  stateGetter = typeof getState === "function" ? getState : () => getState;
  const net = opts.net || getNet();
  if (!net) return false;
  unsub = net.on("shop.bought", onShopBought);
  return true;
}

export function uninstallHostShop() {
  if (unsub) { try { unsub(); } catch { /* ignore */ } }
  unsub = null;
  stateGetter = null;
}

export const _uninstallHostShopForTesting = uninstallHostShop;

// Resolve the player index of the guest that sent the frame. Guests carry a
// playerId on their avatar (state.player2 for slot 2, state.players[] for 3/4);
// the index is what addAmmo / shooting.js key off.
function guestIndexForPlayerId(playerId) {
  const state = stateGetter?.();
  if (!state || !playerId) return null;
  if (state.player2?.playerId === playerId) return state.player2.index | 0;
  if (Array.isArray(state.players)) {
    const s = state.players.find((e) => e.playerId === playerId);
    if (s) return s.player.index | 0;
  }
  return null;
}

function onShopBought(m) {
  const idx = guestIndexForPlayerId(m?.from);
  if (idx == null) return;
  const items = Array.isArray(m?.items) ? m.items : [];
  const after = [];
  for (const it of items) {
    if (!it) continue;
    const sid = it.speciesId | 0;
    const amount = it.amount | 0;
    if (!sid || amount <= 0) continue;
    if (!getSpecies(sid)) continue; // ignore unknown species
    addAmmo(sid, Math.min(amount, MAX_ITEM_AMOUNT), idx);
    after.push({ speciesId: sid, count: getAmmo(sid, idx) });
  }
  // Re-assert the authoritative counts to the buyer (same follow-up pickups.js
  // sends), so a clobbering ammoSet that raced the purchase is corrected.
  if (after.length) broadcastHostEvent("ammoSet", { playerId: m.from, items: after });
}
