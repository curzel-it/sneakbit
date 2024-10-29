use std::{collections::HashMap, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;
use serde_json;
use crate::{config::config, entities::species::{species_by_id, EntityType}, game_engine::entity::Entity, utils::rect::IntRect};

lazy_static! {
    pub static ref INVENTORY: RwLock<Vec<Entity>> = RwLock::new(load_inventory());

    static ref SAVE_THREAD: (Sender<Vec<Entity>>, thread::JoinHandle<()>) = {
        let (tx, rx) = mpsc::channel::<Vec<Entity>>();

        let handle = thread::spawn(move || {
            while let Ok(inventory) = rx.recv() {
                save_inventory(&inventory);
            }
        });
        (tx, handle)
    };
}

pub fn add_to_inventory(entity: Entity) {
    if matches!(entity.entity_type, EntityType::Bundle) {
        let bundle_species = species_by_id(entity.species_id);

        for species_id in bundle_species.bundle_contents {
            let item = species_by_id(species_id).make_entity();
            add_to_inventory(item);
        }
    } else {
        {
            let mut inventory = INVENTORY.write().unwrap();
            inventory.push(entity);
        }
        let inventory = INVENTORY.read().unwrap().clone();
        let tx = &SAVE_THREAD.0;
        tx.send(inventory).expect("Failed to send inventory data to save thread");
    }
}

pub fn remove_from_inventory(id: u32) {
    {
        let mut inventory = INVENTORY.write().unwrap();
        if let Some(pos) = inventory.iter().position(|x| x.id == id) {
            inventory.remove(pos);
        }
    }

    let inventory = INVENTORY.read().unwrap().clone();
    let tx = &SAVE_THREAD.0;
    tx.send(inventory).expect("Failed to send inventory data to save thread");
}

pub fn remove_one_of_species_from_inventory(id: u32) {
    {
        let mut inventory = INVENTORY.write().unwrap();
        if let Some(pos) = inventory.iter().position(|x| x.species_id == id) {
            inventory.remove(pos);
        }
    }

    let inventory = INVENTORY.read().unwrap().clone();
    let tx = &SAVE_THREAD.0;
    tx.send(inventory).expect("Failed to send inventory data to save thread");
}

pub fn get_inventory() -> Vec<Entity> {
    let inventory = INVENTORY.read().unwrap();
    inventory.clone()
}

pub fn inventory_contains_species(species_id: u32) -> bool {
    INVENTORY.read().unwrap().iter().any(|e| e.species_id == species_id)
}

fn load_inventory() -> Vec<Entity> {
    println!("Parsing inventory from {:?}", config().inventory_path);
    match File::open(&config().inventory_path) {
        Ok(file) => {
            let reader = BufReader::new(file);
            match serde_json::from_reader(reader) {
                Ok(inventory) => inventory,
                Err(e) => {
                    eprintln!(
                        "Failed to deserialize inventory file '{:#?}': {}. Starting with empty inventory.",
                        config().inventory_path, e
                    );
                    Vec::new()
                }
            }
        }
        Err(e) => {
            eprintln!(
                "Failed to open inventory file '{:#?}': {}. Starting with empty inventory.",
                config().inventory_path, e
            );
            Vec::new()
        }
    }
}

fn save_inventory(inventory: &Vec<Entity>) {
    if let Ok(serialized_inventory) = serde_json::to_string_pretty(inventory) {
        if let Ok(mut file) = File::create(&config().inventory_path) {
            if let Err(e) = file.write_all(serialized_inventory.as_bytes()) {
                eprintln!("Failed to write inventory file '{:#?}': {}", config().inventory_path, e);
            } else {
                println!("Inventory saved successfully to '{:#?}'", config().inventory_path);
            }
        } else {
            eprintln!("Failed to create inventory file '{:#?}'", config().inventory_path);
        }
    } else {
        eprintln!("Failed to serialize inventory data");
    }
}

#[repr(C)]
pub struct InventoryItem {
    pub species_id: u32,
    pub count: u32,
    pub texture_source_rect: IntRect,
}

pub fn get_inventory_items() -> Vec<InventoryItem> {
    let inventory = get_inventory();
    let mut species_counts = HashMap::new();
    let mut items = Vec::new();

    for entity in &inventory {
        *species_counts.entry(entity.species_id).or_insert(0u32) += 1;
    }

    for (species_id, count) in species_counts {
        let species = species_by_id(species_id);
        let (y, x) = species.inventory_texture_offset;
        let texture_source_rect = IntRect::new(x, y, 1, 1);

        items.push(InventoryItem {
            species_id,
            count,
            texture_source_rect,
        });
    }

    items.sort_by(|a, b| a.species_id.cmp(&b.species_id));

    items
}
