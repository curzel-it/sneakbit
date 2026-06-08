import { test } from "node:test";
import assert from "node:assert/strict";

const skins = await import("../js/skins.js");
const storage = await import("../js/storage.js");
const coopMode = await import("../js/coopMode.js");
const gameMode = await import("../js/gameMode.js");
const sessionSkins = await import("../js/sessionSkins.js");
const { GAME_MODE } = gameMode;

function reset() {
  storage._resetStorageForTesting();
  sessionSkins._resetSessionSkinsForTesting();
  coopMode._setCoopModeForTesting(false);
  gameMode.setGameMode(GAME_MODE.coop);
}

test("the default skin is always owned; others start unowned", () => {
  reset();
  assert.equal(skins.isOwned("default"), true);
  assert.equal(skins.isOwned("ninja_black"), false);
  assert.equal(skins.isOwned("not_a_skin"), false);
});

test("markOwned grants and persists; ownedSkins reflects it", () => {
  reset();
  skins.markOwned("ninja_black");
  assert.equal(skins.isOwned("ninja_black"), true);
  const ids = skins.ownedSkins().map((s) => s.id);
  assert.deepEqual(ids, ["default", "ninja_black"]);
  // markOwned on the default is a no-op (never stored).
  skins.markOwned("default");
  assert.equal(skins.ownedSkins().length, 2);
});

test("getSelected defaults to 'default' and survives a round-trip", () => {
  reset();
  assert.equal(skins.getSelected(), "default");
  skins.markOwned("outfit_red");
  assert.equal(skins.setSelected("outfit_red"), true);
  assert.equal(skins.getSelected(), "outfit_red");
});

test("setSelected refuses a skin you don't own", () => {
  reset();
  assert.equal(skins.setSelected("ninja_black"), false);
  assert.equal(skins.getSelected(), "default");
});

test("getSelected falls back to default if the stored skin is no longer owned", () => {
  reset();
  skins.markOwned("outfit_blue");
  skins.setSelected("outfit_blue");
  // Wipe ownership (e.g. New Game mid-session) but leave selection stored.
  storage.setValue("player.0.skin.owned.outfit_blue", null);
  assert.equal(skins.getSelected(), "default");
});

test("resolveSkinColumn: default renders the per-index column", () => {
  reset();
  for (let i = 0; i < 4; i++) {
    assert.equal(skins.resolveSkinColumn({ index: i }), 1 + i * 4);
  }
});

test("resolveSkinColumn: an equipped skin overrides the per-index column", () => {
  reset();
  skins.markOwned("ninja_black");
  skins.setSelected("ninja_black");
  // ninja_black is column 21 for the player who equipped it (index 0)...
  assert.equal(skins.resolveSkinColumn({ index: 0 }), 21);
  // ...while another local player who hasn't selected it keeps their default.
  assert.equal(skins.resolveSkinColumn({ index: 2 }), 1 + 2 * 4);
});

test("resolveSkinColumn: Tower Defense ignores skins (fixed per-slot columns)", () => {
  reset();
  skins.markOwned("ninja_black");
  skins.setSelected("ninja_black");
  gameMode.setGameMode(GAME_MODE.td);
  assert.equal(skins.resolveSkinColumn({ index: 1 }), 1 + 1 * 4);
});

test("resolveSkinColumn: a synced session skin wins for a networked avatar", () => {
  reset();
  sessionSkins.setSessionSkin("peerA", "tracksuit_black"); // column 17
  assert.equal(skins.resolveSkinColumn({ index: 0, playerId: "peerA" }), 17);
  // An avatar with no session entry falls back to its own per-index default.
  assert.equal(skins.resolveSkinColumn({ index: 0, playerId: "peerB" }), 1);
});

test("local co-op: ownership folds onto P1, but selection stays per-index", () => {
  reset();
  coopMode._setCoopModeForTesting(true);
  // P1 buys a skin → P2 (folded) can equip it from the shared closet.
  skins.markOwned("outfit_blue", 0);
  assert.equal(skins.isOwned("outfit_blue", 1), true);
  // Selection is independent: P2 wearing it leaves P1 on default.
  skins.setSelected("outfit_blue", 1);
  assert.equal(skins.getSelected(1), "outfit_blue");
  assert.equal(skins.getSelected(0), "default");
});
