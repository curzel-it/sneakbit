use std::collections::HashSet;

use common_macros::hash_set;

use crate::{current_menu, entities::known_species::{is_ammo, is_enemy, is_explosive, is_key, is_pickable}, game_engine::{keyboard_events_provider::KeyboardEventsProvider, state_updates::EngineStateUpdate}, is_interaction_available, menus::toasts::{Toast, ToastMode}};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum SoundEffect { 
    AmmoCollected = 1,
    KeyCollected,
    BulletFired,
    BulletBounced,
    DeathOfMonster,
    DeathOfNonMonster,
    SmallExplosion,
    Interaction,
    NoAmmo,
    GameOver,
    PlayerResurrected,
    WorldChange,
    StepTaken,
    HintReceived,
}

pub struct SoundEffectsManager {
    pub current_sound_effects: Vec<SoundEffect>,
    next_sound_effects: HashSet<SoundEffect>,
    last_hero_position: (i32, i32),
    last_world: u32,
}

impl SoundEffectsManager {
    pub fn new() -> Self {
        Self {
            current_sound_effects: vec![],
            next_sound_effects: hash_set![],
            last_hero_position: (0, 0),
            last_world: 0
        }
    }
}

impl SoundEffectsManager {
    pub fn update(&mut self, keyboard: &KeyboardEventsProvider, updates: &Vec<EngineStateUpdate>) {
        self.check_sounds_for_state_updates(updates);

        if did_interact_with_menu(keyboard) {
            self.prepare(SoundEffect::Interaction);
        }
        if did_interact_with_entity(keyboard) {
            self.prepare(SoundEffect::Interaction);
        }
        if self.did_fire_but_no_ammo(keyboard) {
            self.prepare(SoundEffect::NoAmmo);
        }

        self.confirm_next_batch();
    }

    pub fn handle_player_resurrected(&mut self) {
        self.prepare(SoundEffect::PlayerResurrected);
        self.confirm_next_batch();
    }

    fn check_sounds_for_state_updates(&mut self, updates: &Vec<EngineStateUpdate>) {
        updates.iter().for_each(|update| {
            self.check_sounds_for_state_update(update)
        });
    }

    fn check_sounds_for_state_update(&mut self, update: &EngineStateUpdate) {
        match update {
            EngineStateUpdate::EntityRemoved(_, species_id) => self.check_entity_death(*species_id),
            EngineStateUpdate::BulletBounced => self.prepare(SoundEffect::BulletBounced),
            EngineStateUpdate::CenterCamera(x, y, _) => self.check_hero_movement(*x, *y),
            EngineStateUpdate::Teleport(destination) => self.check_teleportation(destination.world),
            EngineStateUpdate::RemoveFromInventory(species_id) => self.check_bullet_fired(*species_id),
            EngineStateUpdate::AddToInventory(species_id) => self.handle_item_collection(*species_id),
            EngineStateUpdate::Toast(toast) => self.check_hint_received(toast),
            EngineStateUpdate::DeathScreen => self.handle_game_over(),
            _ => {}
        }
    }

    fn prepare(&mut self, sound_effect: SoundEffect) {
        self.next_sound_effects.insert(sound_effect);
    }

    fn handle_game_over(&mut self) {
        self.last_world = 0;
        self.last_hero_position = (0, 0);
        self.prepare(SoundEffect::GameOver)
    }

    fn check_bullet_fired(&mut self, species_id: u32) {
        if is_ammo(species_id) {
            self.prepare(SoundEffect::BulletFired);
        }
    }

    fn handle_item_collection(&mut self, species_id: u32) {
        if is_ammo(species_id) {
            self.prepare(SoundEffect::AmmoCollected);
        } else if is_key(species_id) {
            self.prepare(SoundEffect::KeyCollected);
        }
    }

    fn check_entity_death(&mut self, species_id: u32) {
        if is_enemy(species_id) {
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
        if self.last_world == destination {
            self.prepare(SoundEffect::PlayerResurrected);
        } else if self.last_world != 0 {
            self.prepare(SoundEffect::WorldChange);
        }
        self.last_world = destination;
        self.last_hero_position = (0, 0);
    }

    fn confirm_next_batch(&mut self) {
        self.next_sound_effects.iter().for_each(|sound_effect| {
            self.current_sound_effects.push(sound_effect.clone());
        });
        self.next_sound_effects.clear();
    }

    fn check_hero_movement(&mut self, x: i32, y: i32) {
        if self.last_hero_position.0 != x || self.last_hero_position.1 != y {
            self.last_hero_position = (x, y);
            self.prepare(SoundEffect::StepTaken);
        }
    }

    fn did_fire_but_no_ammo(&self, keyboard: &KeyboardEventsProvider) -> bool { 
        keyboard.has_attack_key_been_pressed && !self.next_sound_effects.contains(&SoundEffect::BulletFired)
    }
}

fn did_interact_with_menu(keyboard: &KeyboardEventsProvider) -> bool {
    current_menu().is_visible && 
    keyboard.has_back_been_pressed && 
    keyboard.has_menu_been_pressed && 
    keyboard.has_confirmation_been_pressed && 
    keyboard.has_attack_key_been_pressed && 
    keyboard.has_backspace_been_pressed
}

fn did_interact_with_entity(keyboard: &KeyboardEventsProvider) -> bool {
    is_interaction_available() && keyboard.has_confirmation_been_pressed
}