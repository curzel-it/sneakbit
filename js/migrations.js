// Save migrations. Mirrors Rust features/migrations.rs.
//
// Versioned localStorage prefixes (sneakbit.kv.v1, sneakbit.inventory.v1,
// sneakbit.settings.v1) protect against silent breakage when the schema
// changes — but only if there's actual migration code to walk old saves
// up to the current shape. This module owns that ladder.
//
// Schema version is stored under `build_number` in the regular kv store.
// `runMigrations()` runs once at startup before any feature touches its
// own slice of storage, walks every migration ≥ stored version, then
// stamps the current BUILD_NUMBER. Modules that introduce a breaking
// storage change must:
//   1. Bump BUILD_NUMBER below.
//   2. Push a `{ to, run }` entry to MIGRATIONS describing the upgrade.

import { getValue, setValue } from "./storage.js?v=20260530g";

// Bump on every breaking storage-shape change. Mirror the Rust constant.
export const BUILD_NUMBER = 3;

const KEY_BUILD = "build_number";
const LEGACY_INVENTORY_KEY = "sneakbit.inventory.v1";
const LEGACY_LATEST_WORLD_KEY = "latest_world";
const CURRENT_LATEST_ZONE_KEY = "latest_zone";

// Ordered list of migrations. Each entry: `to` is the version this
// migration upgrades the save TO; `run` performs the rewrite. They're
// applied in `to` order against any save with `build_number < to`.
const MIGRATIONS = [
  {
    // v2: split global inventory + extend equipment to per-player keys.
    // Old layout: one JSON blob at sneakbit.inventory.v1, plus
    // `player.0.equipped.ranged|melee` in the kv store.
    // New layout: `player.{p}.inventory.amount.{species_id}` in the kv
    // store, per-player equipment slots, and the old blob is dropped.
    to: 2,
    run() {
      // Inventory: read the legacy JSON blob, fan into player.0.*.
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(LEGACY_INVENTORY_KEY);
          if (raw) {
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch {}
            if (parsed && typeof parsed === "object") {
              for (const [sid, n] of Object.entries(parsed)) {
                const sidNum = Number(sid);
                const count = Number(n) | 0;
                if (!Number.isFinite(sidNum) || count <= 0) continue;
                setValue(`player.0.inventory.amount.${sidNum}`, count);
              }
            }
            localStorage.removeItem(LEGACY_INVENTORY_KEY);
          }
        } catch {}
      }
      // Equipment: legacy keys (player.0.equipped.ranged / .melee) keep
      // the same shape under the new code, so no rewrite is needed for
      // P1. P2 starts with no overrides — the default kunai launcher
      // fallback kicks in via getEquipped(SLOT_RANGED, 1) on first read.
    },
  },
  {
    // v3: rename the "world" terminology to "zone". The on-disk progress
    // key moved from `latest_world` to `latest_zone`. Copy the old value
    // forward if present, then drop the old key.
    to: 3,
    run() {
      const legacy = getValue(LEGACY_LATEST_WORLD_KEY);
      if (legacy != null && getValue(CURRENT_LATEST_ZONE_KEY) == null) {
        setValue(CURRENT_LATEST_ZONE_KEY, legacy);
      }
      setValue(LEGACY_LATEST_WORLD_KEY, null);
    },
  },
];

export function runMigrations() {
  const current = getValue(KEY_BUILD);
  if (current === BUILD_NUMBER) return { applied: 0, from: current, to: BUILD_NUMBER };
  // First-ever launch: nothing to upgrade, just stamp the current version.
  if (current == null) {
    setValue(KEY_BUILD, BUILD_NUMBER);
    return { applied: 0, from: null, to: BUILD_NUMBER };
  }
  let applied = 0;
  for (const m of MIGRATIONS) {
    if (m.to > current && m.to <= BUILD_NUMBER) {
      try { m.run(); applied++; }
      catch (e) { console.error(`Migration to v${m.to} failed:`, e); }
    }
  }
  setValue(KEY_BUILD, BUILD_NUMBER);
  return { applied, from: current, to: BUILD_NUMBER };
}
