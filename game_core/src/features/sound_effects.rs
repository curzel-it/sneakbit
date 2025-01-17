use std::collections::HashSet;

use common_macros::hash_set;

use crate::{cached_players_positions, constants::WORLD_ID_NONE, entities::known_species::{is_ammo, is_explosive, is_key, is_monster, is_pickable}, features::{state_updates::{AddToInventoryReason, EngineStateUpdate}, storage::{bool_for_global_key, set_value_for_key, StorageKey}}, input::keyboard_events_provider::KeyboardEventsProvider, is_player_by_index_on_slippery_surface, utils::vector::Vector2d};

use super::toasts::{Toast, ToastMode};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[repr(C)]
pub enum SoundEffect { 
    AmmoCollected = 1,
    KeyCollected = 2,
    KnifeThrown = 3,
    BulletBounced = 4,
    DeathOfMonster = 5,
    DeathOfNonMonster = 6,
    SmallExplosion = 7,
    NoAmmo = 8,
    GameOver = 9,
    PlayerResurrected = 10,
    WorldChange = 11,
    StepTaken = 12,
    HintReceived = 13,
    SwordSlash = 14,
    GunShot = 15,
    LoudGunShot = 16
}

pub struct SoundEffectsManager {
    pub current_sound_effects: HashSet<SoundEffect>,
    next_sound_effects: HashSet<SoundEffect>,
    last_players_positions: Vec<Vector2d>,
    last_world: u32,
}

impl SoundEffectsManager {
    pub fn new() -> Self {
        Self {
            current_sound_effects: hash_set![],
            next_sound_effects: hash_set![],
            last_players_positions: vec![],
            last_world: 0,
        }
    }
}

impl SoundEffectsManager {
    pub fn update(&mut self, _: &KeyboardEventsProvider, updates: &[EngineStateUpdate]) {
        self.check_sounds_for_state_updates(updates);
        self.check_hero_movement();
        self.confirm_next_batch();
    }

    pub fn handle_resurrection(&mut self) {
        self.prepare(SoundEffect::PlayerResurrected);
        self.confirm_next_batch();
    }

    pub fn clear(&mut self) {
        self.next_sound_effects.clear();
        self.current_sound_effects.clear();
    }

    fn check_sounds_for_state_updates(&mut self, updates: &[EngineStateUpdate]) {
        updates.iter().for_each(|update| {
            self.check_sounds_for_state_update(update)
        });
    }

    fn check_sounds_for_state_update(&mut self, update: &EngineStateUpdate) {
        match update {
            EngineStateUpdate::EntityKilled(_, species_id) => self.check_entity_death(*species_id),
            EngineStateUpdate::BulletBounced => self.prepare(SoundEffect::BulletBounced),
            EngineStateUpdate::Teleport(destination) => self.check_teleportation(destination.world),
            EngineStateUpdate::AddToInventory(_, species_id, reason) => self.handle_item_collection(*species_id, reason),
            EngineStateUpdate::Toast(toast) => self.check_hint_received(toast),
            EngineStateUpdate::PlayerDied(_) => self.handle_game_over(),
            EngineStateUpdate::NoAmmo(_) => self.prepare(SoundEffect::NoAmmo),
            EngineStateUpdate::SwordSlash(_) => self.prepare(SoundEffect::SwordSlash),
            EngineStateUpdate::GunShot(_) => self.prepare(SoundEffect::GunShot),
            EngineStateUpdate::LoudGunShot(_) => self.prepare(SoundEffect::LoudGunShot),
            EngineStateUpdate::KnifeThrown(_) => self.prepare(SoundEffect::KnifeThrown),
            _ => {}
        }
    }

    fn prepare(&mut self, sound_effect: SoundEffect) {
        self.next_sound_effects.insert(sound_effect);
    }

    fn handle_game_over(&mut self) {
        self.last_world = 0;
        self.last_players_positions.clear();
        self.prepare(SoundEffect::GameOver)
    }

    fn handle_item_collection(&mut self, species_id: u32, reason: &AddToInventoryReason) {
        if matches!(reason, AddToInventoryReason::Reward) {
            return
        }
        if is_ammo(species_id) {
            self.prepare(SoundEffect::AmmoCollected);
        } else if is_key(species_id) {
            self.prepare(SoundEffect::KeyCollected);
        }
    }

    fn check_entity_death(&mut self, species_id: u32) {
        if is_monster(species_id) {
            self.prepare(SoundEffect::DeathOfMonster);
        } else if is_explosive(species_id) {
            self.prepare(SoundEffect::SmallExplosion);
        } else if !is_pickable(species_id) {
            self.prepare(SoundEffect::DeathOfNonMonster);
        }
    }

    fn check_hint_received(&mut self, toast: &Toast) {
        if matches!(toast.mode, ToastMode::Hint) {
            self.prepare(SoundEffect::HintReceived)
        }
    }

    fn check_teleportation(&mut self, destination: u32) {
        if self.last_world != destination && self.last_world != 0 && self.last_world != WORLD_ID_NONE {            
            self.prepare(SoundEffect::WorldChange);
        }
        self.last_world = destination;
        self.last_players_positions.clear();
    }

    fn confirm_next_batch(&mut self) {
        self.current_sound_effects = self.next_sound_effects.clone();        
        self.next_sound_effects.clear();
    }

    fn check_hero_movement(&mut self) {
        let current_positions = cached_players_positions();

        if self.last_players_positions.len() == current_positions.len() {
            for (index, &current_position) in current_positions.iter().enumerate().take(self.last_players_positions.len()) {
                if self.last_players_positions[index] != current_position && !is_player_by_index_on_slippery_surface(index) {
                    self.prepare(SoundEffect::StepTaken);
                }
            }
        }
        self.last_players_positions = current_positions;
    }
}

pub fn are_sound_effects_enabled() -> bool {
    !bool_for_global_key(&StorageKey::are_sound_effects_disabled())
}

pub fn toggle_sound_effects() {
    if are_sound_effects_enabled() {
        disable_sound_effects();
    } else {
        enable_sound_effects();
    }
}

fn enable_sound_effects() {
    set_value_for_key(&StorageKey::are_sound_effects_disabled(), 0);
}

fn disable_sound_effects() {
    set_value_for_key(&StorageKey::are_sound_effects_disabled(), 1);
}

pub fn is_music_enabled() -> bool {
    !bool_for_global_key(&StorageKey::is_music_disabled())
}

pub fn toggle_music() {
    if is_music_enabled() {
        disable_music();
    } else {
        enable_music();
    }
}

fn enable_music() {
    set_value_for_key(&StorageKey::is_music_disabled(), 0);
}

fn disable_music() {
    set_value_for_key(&StorageKey::is_music_disabled(), 1);
}