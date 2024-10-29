use std::{collections::BTreeMap, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;

use crate::config::config;

use super::{
    locks::{
        PRESSURE_PLATE_BLUE, PRESSURE_PLATE_GREEN, PRESSURE_PLATE_RED, PRESSURE_PLATE_SILVER,
        PRESSURE_PLATE_YELLOW,
    },
    world::World,
};

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

pub fn save_pressure_plate_states(world: &World) {
    set_value_for_key(PRESSURE_PLATE_YELLOW, world.pressure_plate_down_yellow.to_int());
    set_value_for_key(PRESSURE_PLATE_RED, world.pressure_plate_down_red.to_int());
    set_value_for_key(PRESSURE_PLATE_BLUE, world.pressure_plate_down_blue.to_int());
    set_value_for_key(PRESSURE_PLATE_GREEN, world.pressure_plate_down_green.to_int());
    set_value_for_key(PRESSURE_PLATE_SILVER, world.pressure_plate_down_silver.to_int());
}

trait IntConvertible {
    fn to_int(&self) -> u32;
}

impl IntConvertible for bool {
    fn to_int(&self) -> u32 {
        if *self { 1 } else { 0 }
    }
}
