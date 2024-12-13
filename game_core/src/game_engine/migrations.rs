use crate::{constants::BUILD_NUMBER, entities::known_species::{SPECIES_KUNAI_LAUNCHER, SPECIES_SWORD}};

use super::{engine::GameEngine, storage::{get_value_for_global_key, set_value_for_key, StorageKey}};

impl GameEngine {
    pub fn run_migrations(&self) {
        if let Some(latest_build) = get_value_for_global_key(&StorageKey::build_number()) {
            run_migrations_from(latest_build)
        } else {
            set_value_for_key(&StorageKey::build_number(), LAST_VERSION_WITHOUT_BUILD_NUMBER_INIT);
            run_migrations_from(LAST_VERSION_WITHOUT_BUILD_NUMBER_INIT)
        }

        set_value_for_key(&StorageKey::build_number(), BUILD_NUMBER);
    }
}

const LAST_VERSION_WITHOUT_BUILD_NUMBER_INIT: u32 = 34;

const SPECIES_SWORD_ITEM: u32 = 1164;

fn run_migrations_from(latest_build: u32) {
    // Changelo:
    // - Each player has its own inventory
    // - Each player has a equipment slots for a sword and a gun
    // - Kunai launcher is the default gun
    if latest_build < 35 {
        set_value_for_key(&StorageKey::currently_equipped_gun(0), SPECIES_KUNAI_LAUNCHER);

        if get_value_for_global_key("inventory.amount.1164").unwrap_or_default() > 0 {
            set_value_for_key(&StorageKey::currently_equipped_sword(0), SPECIES_SWORD);
            set_value_for_key(&StorageKey::species_inventory_count(&SPECIES_SWORD_ITEM, 0), 1);
        }
    }
}
