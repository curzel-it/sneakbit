use std::{collections::BTreeMap, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;

use crate::config::config;

use super::{entity::EntityId, locks::LockType};

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

    fn has_boomerang_skill() -> String {
        "dialogue.answer.bullet_boomerang_skill_intro".to_owned()
    }

    fn has_bullet_catcher_skill() -> String {
        "dialogue.answer.bullet_catcher_skill_intro".to_owned()
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

pub fn get_value_for_key(key: &str) -> Option<u32> {
    if key == StorageKey::always() {
        return Some(1);
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

pub fn lock_override(id: &EntityId) -> Option<LockType> {
    get_value_for_key(&lock_override_key(id)).and_then(|lock_id| LockType::from_int(&lock_id))
}

fn lock_override_key(id: &EntityId) -> String {
    format!("lock_override.{}", id)
}

pub fn has_boomerang_skill() -> bool {
    get_value_for_key(&StorageKey::has_boomerang_skill()).is_some_and(|i| i == 1)
}

pub fn has_bullet_catcher_skill() -> bool {
    get_value_for_key(&StorageKey::has_bullet_catcher_skill()).is_some_and(|i| i == 1)
}