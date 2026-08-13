// Default audio levels, and what an update migrating from the Rust build
// lands on. Those builds had on/off toggles and no sliders, so there is no
// level to port: legacySettingsPatch only writes a volume to say "this
// channel was off", and everything else falls through to the defaults here.

import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = (() => {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => Array.from(m.keys())[i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

const SETTINGS_KEY = "sneakbit.settings.v1";

const { loadSettings } = await import("../js/settings.js");
const { legacySettingsPatch } = await import("../js/legacySave.js");

function freshLoad(stored) {
  localStorage.clear();
  if (stored) localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
  return loadSettings();
}

test("a fresh install starts at music 40% / sfx 65%", () => {
  const s = freshLoad(null);
  assert.equal(s.musicVolume, 0.4);
  assert.equal(s.sfxVolume, 0.65);
});

test("migrating a player who had sound on lands on those same levels", () => {
  const s = freshLoad(legacySettingsPatch({ latest_world: 1011 }, { sfx: true, music: true }));
  assert.equal(s.musicVolume, 0.4);
  assert.equal(s.sfxVolume, 0.65);
  assert.equal(s.muted, false);
});

test("a channel the player had turned off stays at zero", () => {
  const s = freshLoad(legacySettingsPatch({
    "desktop_only.game_settings.music_disabled": 1,
  }, null));
  assert.equal(s.musicVolume, 0);
  assert.equal(s.sfxVolume, 0.65, "sfx was on — it gets the default level");
});
