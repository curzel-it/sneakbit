use std::{collections::{HashMap, HashSet}, fs::File, io::{BufReader, Write}, sync::{mpsc::{self, Sender}, RwLock}, thread};
use lazy_static::lazy_static;

use crate::{config::config, constants::MAX_PLAYERS, entities::species::{species_by_id, SpeciesId}, equipment::basics::set_equipped, worlds::world::World};

use super::{entity::EntityId, locks::LockType};

const INVENTORY_AMOUNT: &str = "inventory.amount";
const PLAYER: &str = "player";

pub struct StorageKey {}

impl StorageKey {
    pub fn always() -> String {
        "always".to_owned()
    }

    pub fn is_mobile() -> String {
        "is_mobile".to_string()
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

    pub fn fullscreen() -> String {
        "fullscreen".to_owned()
    }

    pub fn are_sound_effects_disabled() -> String {
        "desktop_only.game_settings.sound_effects_disabled".to_owned()
    }

    pub fn is_music_disabled() -> String {
        "desktop_only.game_settings.music_disabled".to_owned()
    }

    pub fn item_collected(id: EntityId) -> String {
        format!("item_collected.{}", id)
    }

    pub fn build_number() -> String {
        "build_number".to_owned()
    }

    pub fn language() -> String {
        "language".to_owned()
    }

    pub fn currently_equipped_ranged_weapon(player: usize) -> String {
        format!("{}.{}.currently_equipped_ranged_weapon", PLAYER, player)
    }

    pub fn currently_equipped_melee_weapon(player: usize) -> String {
        format!("{}.{}.currently_equipped_melee_weapon", PLAYER, player)
    }

    fn dialogue_answer(dialogue: &str) -> String {
        format!("dialogue.answer.{}", dialogue)
    }

    fn dialogue_reward_collected(dialogue: &str) -> String {
        format!("dialogue.reward.{}", dialogue)
    }

    pub fn species_inventory_count(species_id: &SpeciesId, player: usize) -> String {
        format!("{}.{}.{}.{}", PLAYER, player, INVENTORY_AMOUNT, species_id)
    }

    pub fn did_visit(world_id: u32) -> String {
        format!("world.visited.{}", world_id)
    }
}

fn load_stored_values() -> HashMap<String, u32> {
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
            return HashMap::new();
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
            HashMap::new()
        }
    }
}

fn save_stored_values(data: &HashMap<String, u32>) {
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
    static ref KEY_VALUE_STORAGE: RwLock<HashMap<String, u32>> =
        RwLock::new(load_stored_values());

    static ref SAVE_THREAD: (Sender<HashMap<String, u32>>, thread::JoinHandle<()>) = {
        let (tx, rx) = mpsc::channel::<HashMap<String, u32>>();

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
    if key == StorageKey::is_mobile() {
        return if config().is_mobile { Some(1) } else { Some(0) };
    }
    if key.contains(INVENTORY_AMOUNT) && !key.contains(PLAYER) {
        for player_index in 0..MAX_PLAYERS {
            let fixed_key = &key.replace(INVENTORY_AMOUNT, &format!("{}.{}.{}", PLAYER, player_index, INVENTORY_AMOUNT));
            
            if let Some(value) = get_value_for_global_key(fixed_key) {
                return Some(value)
            }
        }
        return None
    }
    if key.contains(",") {
        let keys = key.split_terminator(",");
        let values: HashSet<Option<u32>> = keys.map(get_value_for_global_key).collect();
        if values.len() == 1 {
            return *values.iter().next().unwrap_or(&None)
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

pub fn has_piercing_knife_skill() -> bool {
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

pub fn increment_inventory_count(species_id: SpeciesId, player: usize) {
    let species = species_by_id(species_id);

    if !species.bundle_contents.is_empty() {
        species.bundle_contents
            .into_iter()
            .for_each(|species_id| increment_inventory_count(species_id, player));
    } else {
        increment_value(&StorageKey::species_inventory_count(&species.id, player));

        if let Some(weapon_id) = species.associated_weapon {
            let weapon_species = species_by_id(weapon_id);
            set_equipped(&weapon_species, player);
        }
    }
}

pub fn decrease_inventory_count(species_id: &SpeciesId, player: usize) {
    decrease_value(&StorageKey::species_inventory_count(species_id, player));
}

pub fn inventory_count(species_id: &SpeciesId, player: usize) -> u32 {
    get_value_for_global_key(&StorageKey::species_inventory_count(species_id, player)).unwrap_or_default()
}

pub fn has_species_in_inventory(species_id: &SpeciesId, player: usize) -> bool {
    inventory_count(species_id, player) > 0
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

pub fn get_stored_values_snapshot() -> HashMap<String, u32> {
    KEY_VALUE_STORAGE.read().unwrap().clone()
}

pub fn replace_all_stored_values(new: HashMap<String, u32>) {
    {
        let mut storage = KEY_VALUE_STORAGE.write().unwrap();
        storage.clone_from(&new);
    }
    let storage = KEY_VALUE_STORAGE.read().unwrap().clone();
    let tx = &SAVE_THREAD.0;
    tx.send(storage).expect("Failed to send data to save thread");
}