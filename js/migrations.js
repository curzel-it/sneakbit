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

import { getValue, setValue } from "./storage.js";

// Bump on every breaking storage-shape change. Mirror the Rust constant.
export const BUILD_NUMBER = 1;

const KEY_BUILD = "build_number";

// Ordered list of migrations. Each entry: `to` is the version this
// migration upgrades the save TO; `run` performs the rewrite. They're
// applied in `to` order against any save with `build_number < to`.
const MIGRATIONS = [
  // Example for the next breaking change (kept commented as documentation):
  // {
  //   to: 2,
  //   run() {
  //     // e.g. rename the equipment storage key:
  //     const old = getValue("player.0.equipped.gun");
  //     if (old != null) {
  //       setValue("player.0.equipped.ranged", old);
  //       setValue("player.0.equipped.gun", null);
  //     }
  //   },
  // },
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
