// Tower Defense save context: a per-run, in-memory save that never touches the
// real game's progress. A TD run buys gear, burns ammo and banks coins through
// the SAME features the normal game uses (wallet.js, inventory.js,
// equipment.js) — they're just pointed at a transient backing for the run's
// lifetime, so a session can't pollute (or be polluted by) the player's save.
//
// The isolation has two halves:
//   • storage.js intercepts the TD-owned keys into a transient map that skips
//     localStorage (player.<n>.{inventory.amount.*,equipped.*,coins}).
//   • wallet.js / inventory.js keep their own in-memory mirrors, so we flush
//     those here too — otherwise they'd serve the real save's cached values.
//     equipment.js reads storage on every call, so it needs no flush.
//
// Leaving TD reloads the page (the pause-menu quit path), which drops all of
// this and re-reads the real save — so this is a one-way switch in practice and
// never has to restore the real caches in place. enterTdSave() is also called
// on a TD restart, where enterTransientContext() wipes the prior run clean.

import { enterTransientContext } from "./storage.js";
import { resetWalletCache } from "./wallet.js";
import { resetInventoryCache } from "./inventory.js";

// Begin (or restart) a transient TD run: flip storage into the TD-owned
// transient context and drop the wallet/inventory mirrors so the squad starts
// from an empty purse + empty packs. The caller (towerDefense.startTowerDefense)
// seeds the starting coins and per-hero ammo immediately after.
export function enterTdSave() {
  enterTransientContext();
  resetWalletCache();
  resetInventoryCache();
}
