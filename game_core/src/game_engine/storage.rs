use std::{collections::{BTreeMap, HashSet}, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;

use crate::{config::config, entities::species::{species_by_id, SpeciesId}};

use super::{entity::EntityId, locks::LockType, world::World};

pub struct StorageKey {}

impl StorageKey {
    pub fn always() -> String {
        "always".to_owned()
    }

    pub fn previous_world() -> String {
        "previous_world".to_owned()
    }

    pub fn latest_world() -> String {
        "latest_world".to_owned()
    }

    pub fn npc_interaction(id: u32) -> String {
        format!("npc_interactions.{}", id)
    }

    pub fn content_read(id: u32) -> String {
        format!("content_read.{}", id)   
    }

    pub fn fullscreen() -> String {
        "fullscreen".to_owned()
    }

    fn dialogue_answer(dialogue: &str) -> String {
        format!("dialogue.answer.{}", dialogue)
    }

    fn dialogue_reward_collected(dialogue: &str) -> String {
        format!("dialogue.reward.{}", dialogue)
    }

    fn species_inventory_count(species_id: &SpeciesId) -> String {
        format!("inventory.amount.{}", species_id)
    }
}

fn load_stored_values() -> BTreeMap<String, u32> {
    println!(
        "Parsing save from {:#?}",
        config().key_value_storage_path.clone()
    );
    
    let file = match File::open(&config().key_value_storage_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!(
                "Failed to open {:#?}: {}. Starting with an empty storage.",
                config().key_value_storage_path, e
            );
            return BTreeMap::new();
        }
    };

    let reader = BufReader::new(file);

    match serde_json::from_reader(reader) {
        Ok(map) => map,
        Err(e) => {
            eprintln!(
                "Failed to deserialize JSON from {:#?}: {}. Starting with an empty storage.",
                config().key_value_storage_path, e
            );
            BTreeMap::new()
        }
    }
}

fn save_stored_values(data: &BTreeMap<String, u32>) {
    if let Ok(serialized_world) = serde_json::to_string_pretty(data) {
        if let Ok(mut file) = File::create(&config().key_value_storage_path) {
            if let Err(e) = file.write_all(serialized_world.as_bytes()) {
                eprintln!("Failed to write save file: {}", e);
            } else {
                println!("Data saved successfully to storage.json");
            }
        } else {
            eprintln!("Failed to create save file");
        }
    } else {
        eprintln!("Failed to serialize data");
    }
}

lazy_static! {
    static ref KEY_VALUE_STORAGE: RwLock<BTreeMap<String, u32>> =
        RwLock::new(load_stored_values());

    static ref SAVE_THREAD: (Sender<BTreeMap<String, u32>>, thread::JoinHandle<()>) = {
        let (tx, rx) = mpsc::channel::<BTreeMap<String, u32>>();

        let handle = thread::spawn(move || {
            while let Ok(data) = rx.recv() {
                save_stored_values(&data);
            }
        });

        (tx, handle)
    };
}

pub fn get_value_for_key(key: &str, world: &World) -> Option<u32> {
    if key.contains("pressure_plate_down") {
        let lock_name = key.replace("pressure_plate_down_", "");
        let lock_type = LockType::from_string(&lock_name);        
        return Some(if world.is_pressure_plate_down(&lock_type) { 1 } else { 0 })
    }
    get_value_for_global_key(key)
}

pub fn get_value_for_global_key(key: &str) -> Option<u32> {
    if key == StorageKey::always() {
        return Some(1);
    }
    if key.contains(",") {
        let keys = key.split_terminator(",");
        let values: HashSet<Option<u32>> = keys.map(|k| get_value_for_global_key(k)).collect();
        if values.len() == 1 {
            return values.iter().next().unwrap_or(&None).clone()
        } else {
            return None
        }
    } 
    let storage = KEY_VALUE_STORAGE.read().unwrap();
    storage.get(key).cloned()
}

pub fn bool_for_global_key(key: &str) -> bool {
    get_value_for_global_key(key).is_some_and(|v| v == 1)
}

pub fn set_value_for_key(key: &str, value: u32) {
    {
        let mut storage = KEY_VALUE_STORAGE.write().unwrap();
        storage.insert(key.to_owned(), value);
    }
    let storage = KEY_VALUE_STORAGE.read().unwrap().clone();
    let tx = &SAVE_THREAD.0;
    tx.send(storage).expect("Failed to send data to save thread");
}

pub fn save_lock_override(id: &EntityId, lock_type: &LockType) {
    set_value_for_key(&lock_override_key(id), lock_type.as_int());
}

pub fn key_value_matches(key: &str, world: &World, expected_value: u32) -> bool {
    let value = get_value_for_key(key, world);
    value_matches(key, value, expected_value)
}

pub fn global_key_value_matches(key: &str, expected_value: u32) -> bool {
    let value = get_value_for_global_key(key);
    value_matches(key, value, expected_value)
}

fn value_matches(key: &str, value: Option<u32>, expected_value: u32) -> bool {
    key == StorageKey::always() || value == Some(expected_value) || (expected_value == 0 && value.is_none())
}

pub fn lock_override(id: &EntityId) -> Option<LockType> {
    let key = &lock_override_key(id);
    get_value_for_global_key(key).and_then(|lock_id| LockType::from_int(&lock_id))
}

fn lock_override_key(id: &EntityId) -> String {
    format!("lock_override.{}", id)
}

pub fn has_boomerang_skill() -> bool {
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.black_ninja.gain_bouncing_knifes_skill").is_some_and(|i| i == 1)
}

pub fn has_bullet_catcher_skill() -> bool {
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.blue_ninja.gain_knife_catcher_skill").is_some_and(|i| i == 1)
}

pub fn has_piercing_bullet_skill() -> bool {
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.red_ninja.gain_piercing_knife_skill").is_some_and(|i| i == 1)
}

pub fn set_dialogue_read(dialogue: &str) {
    set_value_for_key(&StorageKey::dialogue_answer(dialogue), 1);
}

pub fn set_dialogue_reward_collected(dialogue: &str) {
    set_value_for_key(&StorageKey::dialogue_reward_collected(dialogue), 1);    
}

pub fn has_dialogue_reward_been_collected(dialogue: &str) -> bool {
    if let Some(collected) = get_value_for_global_key(&StorageKey::dialogue_reward_collected(dialogue)) {
        collected == 1
    } else {
        false
    }
}

fn increment_value(key: &str) {
    let current_value = get_value_for_global_key(key).unwrap_or_default();
    let next_value = current_value.saturating_add(1);
    set_value_for_key(key, next_value);
}

fn decrease_value(key: &str) {
    let current_value = get_value_for_global_key(key).unwrap_or_default();
    let next_value = current_value.saturating_sub(1);
    set_value_for_key(key, next_value);
}

pub fn increment_inventory_count(species_id: &SpeciesId) {
    let species = species_by_id(*species_id);
    if !species.bundle_contents.is_empty() {
        species.bundle_contents.iter().for_each(|id|increment_inventory_count(id));
    } else {
        increment_value(&StorageKey::species_inventory_count(species_id));
    }
}

pub fn decrease_inventory_count(species_id: &SpeciesId) {
    decrease_value(&StorageKey::species_inventory_count(species_id));
}

pub fn inventory_count(species_id: &SpeciesId) -> u32 {
    get_value_for_global_key(&StorageKey::species_inventory_count(species_id)).unwrap_or_default()
}

pub fn has_species_in_inventory(species_id: &SpeciesId) -> bool {
    inventory_count(species_id) > 0
}

pub fn reset_all_stored_values() {
    {
        let mut storage = KEY_VALUE_STORAGE.write().unwrap();
        storage.clear();
    }
    let storage = KEY_VALUE_STORAGE.read().unwrap().clone();
    let tx = &SAVE_THREAD.0;
    tx.send(storage).expect("Failed to send data to save thread");
}