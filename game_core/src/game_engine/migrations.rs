use crate::entities::known_species::{SPECIES_KUNAI_LAUNCHER, SPECIES_SWORD};

use super::{engine::GameEngine, storage::{get_value_for_global_key, set_value_for_key, StorageKey}};

impl GameEngine {
    pub fn run_migrations(&self) {
        if let Some(latest_build) = get_value_for_global_key(&StorageKey::build_number()) {
            run_migrations_from(latest_build)
        }
    }
}

const EQUIPMENT_SWORD_VS_GUNS: u32 = 35;
const SPECIES_SWORD_ITEM: u32 = 1159;

fn run_migrations_from(latest_build: u32) {
    // Since version 35 players can equip one sword and one gun
    // Previous versions only had two "harcoded" weapons
    // Set them as equipped and GG
    if latest_build < EQUIPMENT_SWORD_VS_GUNS {
        set_value_for_key(&StorageKey::currently_equipped_gun(), SPECIES_KUNAI_LAUNCHER);

        if get_value_for_global_key(&StorageKey::species_inventory_count(&SPECIES_SWORD_ITEM)).unwrap_or_default() > 0 {
            set_value_for_key(&StorageKey::currently_equipped_sword(), SPECIES_SWORD);
            set_value_for_key(&StorageKey::species_inventory_count(&SPECIES_SWORD_ITEM), 1);
        }
    }
}
