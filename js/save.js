// Persistent game progress: which world the player was last in, and where
// they were standing. Mirrors the Rust core's `latest_world` storage key
// plus a few extra slots for the spawn tile and facing direction.
//
// All other persistent state (dialogue answers, inventory counts, skill
// unlocks, equipment, etc.) already lives in storage.js — this module
// only handles the bits the engine actively pushes back on world change.

import { getValue, setValue } from "./storage.js";

const KEY_LATEST_WORLD = "latest_world";
const KEY_PLAYER_X = "player.0.spawn.tileX";
const KEY_PLAYER_Y = "player.0.spawn.tileY";
const KEY_PLAYER_DIR = "player.0.spawn.direction";

const DIR_TO_INT = { down: 0, up: 1, left: 2, right: 3 };
const INT_TO_DIR = ["down", "up", "left", "right"];

export function saveProgress(state) {
  const world = state?.world;
  const player = state?.player;
  if (!world || !player) return;
  setValue(KEY_LATEST_WORLD, world.id);
  setValue(KEY_PLAYER_X, player.tileX | 0);
  setValue(KEY_PLAYER_Y, player.tileY | 0);
  const dirIdx = DIR_TO_INT[player.direction];
  if (dirIdx != null) setValue(KEY_PLAYER_DIR, dirIdx);
}

// Returns `{ worldId, x, y, direction }` or null if no save is present.
export function loadProgress() {
  const worldId = getValue(KEY_LATEST_WORLD);
  if (worldId == null) return null;
  const x = getValue(KEY_PLAYER_X);
  const y = getValue(KEY_PLAYER_Y);
  const dirIdx = getValue(KEY_PLAYER_DIR);
  return {
    worldId,
    x: x == null ? null : x,
    y: y == null ? null : y,
    direction: dirIdx == null ? null : INT_TO_DIR[dirIdx] || null,
  };
}

export function clearProgress() {
  setValue(KEY_LATEST_WORLD, null);
  setValue(KEY_PLAYER_X, null);
  setValue(KEY_PLAYER_Y, null);
  setValue(KEY_PLAYER_DIR, null);
}

export function hasSavedProgress() {
  return getValue(KEY_LATEST_WORLD) != null;
}
