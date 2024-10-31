use std::{collections::HashMap, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;
use crate::{config::config, entities::species::{species_by_id, EntityType}, utils::rect::IntRect};

lazy_static! {
    pub static ref INVENTORY: RwLock<HashMap<u32, u32>> = RwLock::new(load_inventory());

    static ref SAVE_THREAD: (Sender<HashMap<u32, u32>>, thread::JoinHandle<()>) = {
        let (tx, rx) = mpsc::channel::<HashMap<u32, u32>>();

        let handle = thread::spawn(move || {
            while let Ok(inventory) = rx.recv() {
                save_inventory(&inventory);
            }
        });
        (tx, handle)
    };
}

pub fn add_to_inventory(species_id: &u32, count: u32) {
    let species = species_by_id(*species_id);

    if matches!(species.entity_type, EntityType::Bundle) {
        for &content_species_id in &species.bundle_contents {
            add_to_inventory(&content_species_id, 1);
        }
    } else {
        {
            let mut inventory = INVENTORY.write().unwrap();
            *inventory.entry(*species_id).or_insert(0) += count;
        }
        let inventory = INVENTORY.read().unwrap().clone();
        let tx = &SAVE_THREAD.0;
        tx.send(inventory).expect("Failed to send inventory data to save thread");
    }
}

pub fn remove_from_inventory(species_id: &u32, count: u32) {
    let mut inventory = INVENTORY.write().unwrap();
    if let Some(current_count) = inventory.get_mut(&species_id) {
        if *current_count >= count {
            *current_count -= count;
            if *current_count == 0 {
                inventory.remove(species_id);
            }
            drop(inventory);
            let inventory = INVENTORY.read().unwrap().clone();
            let tx = &SAVE_THREAD.0;
            tx.send(inventory).expect("Failed to send inventory data to save thread");
        }
    }
}

pub fn remove_one_of_species_from_inventory(species_id: &u32) {
    remove_from_inventory(species_id, 1)
}

pub fn get_inventory() -> HashMap<u32, u32> {
    let inventory = INVENTORY.read().unwrap();
    inventory.clone()
}

pub fn inventory_contains_species(species_id: u32) -> bool {
    INVENTORY.read().unwrap().contains_key(&species_id)
}

fn load_inventory() -> HashMap<u32, u32> {
    println!("Parsing inventory from {:?}", config().inventory_path);
    match File::open(&config().inventory_path) {
        Ok(file) => {
            let reader = BufReader::new(file);
            match serde_json::from_reader::<_, Vec<[u32; 2]>>(reader) {
                Ok(vec) => vec
                    .into_iter()
                    .map(|pair| (pair[0], pair[1]))
                    .collect(),
                Err(e) => {
                    eprintln!(
                        "Failed to deserialize inventory file '{:#?}': {}. Starting with empty inventory.",
                        config().inventory_path, e
                    );
                    HashMap::new()
                }
            }
        }
        Err(e) => {
            eprintln!(
                "Failed to open inventory file '{:#?}': {}. Starting with empty inventory.",
                config().inventory_path, e
            );
            HashMap::new()
        }
    }
}

fn save_inventory(inventory: &HashMap<u32, u32>) {
    let vec: Vec<[u32; 2]> = inventory.iter().map(|(&k, &v)| [k, v]).collect();
    if let Ok(serialized_inventory) = serde_json::to_string_pretty(&vec) {
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

pub fn inventory_items_count_for_species(species_id: u32) -> usize {
    INVENTORY.read().unwrap().get(&species_id).map(|&count| count as usize).unwrap_or(0)
}

pub fn get_inventory_items() -> Vec<InventoryItem> {
    let inventory = get_inventory();
    let mut items = Vec::new();

    for (&species_id, &count) in &inventory {
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
