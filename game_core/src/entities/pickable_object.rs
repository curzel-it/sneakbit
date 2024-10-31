use crate::{constants::SPRITE_SHEET_INVENTORY, entities::species::species_by_id, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World}, lang::localizable::LocalizableText, menus::toasts::{Toast, ToastImage}};

impl Entity {
    pub fn update_pickable_object(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {              
        if !world.creative_mode && world.is_hero_at(self.frame.x, self.frame.y) {
            object_pick_up_sequence(self)
        } else {
            vec![]
        }
    }
}

pub fn object_pick_up_sequence(entity: &Entity) -> Vec<WorldStateUpdate> {    
    vec![
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::AddToInventory(
                entity.species_id
            )
        ),
        WorldStateUpdate::RemoveEntity(entity.id),
        WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame),
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::Toast(
                Toast::regular_with_image(
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