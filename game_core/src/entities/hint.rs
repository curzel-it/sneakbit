use crate::{constants::{SPRITE_SHEET_INVENTORY, SPRITE_SHEET_STATIC_OBJECTS}, features::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{get_value_for_global_key, set_value_for_key, StorageKey}, toasts::{Toast, ToastMode}}, is_creative_mode, lang::localizable::LocalizableText, worlds::world::World};

impl Entity {
    pub fn setup_hint(&mut self) {
        if is_creative_mode() { 
            self.sprite.sheet_id = SPRITE_SHEET_INVENTORY;
            self.sprite.frame.x = self.species.inventory_texture_offset.1;
            self.sprite.frame.y = self.species.inventory_texture_offset.0;
        } else {
            self.sprite.sheet_id = SPRITE_SHEET_STATIC_OBJECTS;
            self.sprite.frame.x = 4;
            self.sprite.frame.y = 2;
        }
    }

    pub fn update_hint(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        if !is_creative_mode() && world.is_any_hero_at(self.frame.x, self.frame.y) {
            self.hint_updates()    
        } else {
            vec![]
        }
    }

    fn hint_updates(&self) -> Vec<WorldStateUpdate> {
        if self.is_consumable && self.has_been_read() || self.dialogues.is_empty() {
            vec![]
        } else {
            self.set_read();
            vec![self.toast()]
        }        
    }

    fn toast(&self) -> WorldStateUpdate {
        WorldStateUpdate::EngineUpdate(EngineStateUpdate::Toast(            
            Toast::new(
                ToastMode::Hint,
                self.key().localized()
            )
        ))
    }

    fn key(&self) -> String {
        if self.dialogues.is_empty() {
            "".to_owned()
        } else {
            self.dialogues[0].text.clone()
        }
    }

    fn has_been_read(&self) -> bool {
        has_hint_been_read(&self.key())
    }

    fn set_read(&self) {
        set_hint_read(&self.key())
    }
}

impl StorageKey {
    fn hint_read(hint: &str) -> String {
        format!("hint.read.{}", hint)
    }
}

fn set_hint_read(hint: &str) {
    set_value_for_key(&StorageKey::hint_read(hint), 1);
}

fn has_hint_been_read(hint: &str) -> bool {
    if let Some(read) = get_value_for_global_key(&StorageKey::hint_read(hint)) {
        read == 1
    } else {
        false
    }
}