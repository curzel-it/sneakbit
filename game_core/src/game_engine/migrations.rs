use std::collections::HashMap;

use crate::{constants::BUILD_NUMBER, entities::known_species::{SPECIES_KUNAI_LAUNCHER, SPECIES_SWORD}};

use super::{engine::GameEngine, storage::{get_stored_values_snapshot, get_value_for_global_key, replace_all_stored_values, set_value_for_key, StorageKey}};

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
    // Changelog:
    // - Each player has its own inventory
    // - Each player has equipment slots for one sword and one gun
    // - Kunai launcher is the default gun
    if latest_build < 35 {
        let values = get_stored_values_snapshot();
        
        let mut updated_values: HashMap<String, u32> = values
            .iter()
            .map(|(key, &value)| {
                if key.starts_with("inventory.amount") {
                    let updated_key = key.replace("inventory.amount.", "player.0.inventory.amount.");
                    (updated_key, value)
                } else {
                    (key.to_owned(), value)
                }                
            })
            .collect();

        updated_values.insert(StorageKey::currently_equipped_gun(0), SPECIES_KUNAI_LAUNCHER);

        if let Some(&value) = updated_values.get(&StorageKey::species_inventory_count(&1164, 0)) {
            if value > 0 {
                updated_values.insert(StorageKey::currently_equipped_sword(0), SPECIES_SWORD);
                updated_values.insert(StorageKey::species_inventory_count(&SPECIES_SWORD_ITEM, 0), 1);
            }
        }

        replace_all_stored_values(updated_values);
    }
}
