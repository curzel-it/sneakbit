use std::{collections::{BTreeMap, HashSet}, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;

use crate::config::config;

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
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.8a").is_some_and(|i| i == 1) || 
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.8b").is_some_and(|i| i == 1) 
}

pub fn has_bullet_catcher_skill() -> bool {
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.5a").is_some_and(|i| i == 1) || 
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.5b").is_some_and(|i| i == 1) 
}

pub fn has_piercing_bullet_skill() -> bool {
    get_value_for_global_key("dialogue.answer.quest.ninja_skills.11").is_some_and(|i| i == 1)
}