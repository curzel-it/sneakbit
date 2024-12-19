use crate::{constants::SPRITE_SHEET_INVENTORY, entities::species::species_by_id, features::{entity::Entity, state_updates::{AddToInventoryReason, EngineStateUpdate, WorldStateUpdate}}, is_creative_mode, lang::localizable::LocalizableText, menus::toasts::{Toast, ToastImage, ToastMode}, worlds::world::World};

impl Entity {
    pub fn update_pickable_object(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {              
        if is_creative_mode() {
            return vec![]
        }        
        if let Some(player) = world.index_of_player_at(self.frame.x, self.frame.y) {
            object_pick_up_sequence(player, self)
        } else {
            vec![]
        }
    }
}

pub fn object_pick_up_sequence(player: usize, entity: &Entity) -> Vec<WorldStateUpdate> {    
    vec![
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::AddToInventory(
                player,
                entity.species_id, 
                AddToInventoryReason::PickedUp
            )
        ),
        WorldStateUpdate::RemoveEntity(entity.id),
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::Toast(
                Toast::new_with_image(
                    ToastMode::Regular,
                    "picked_up_item".localized().replace("%s", &entity.name),
                    ToastImage::static_image(
                        species_by_id(entity.species_id).inventory_sprite_frame(), 
                        SPRITE_SHEET_INVENTORY
                    )
                )
            )
        ),
    ]    
}