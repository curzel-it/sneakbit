use crate::{entities::{species::EntityType, teleporter::is_player_entering_tile}, features::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}}, worlds::world::World};

impl Entity {
    pub fn setup_pvp_arena(&mut self) {
        self.is_rigid = true;
    }

    pub fn update_pvp_arena(&mut self, world: &World) -> Vec<WorldStateUpdate> {   
        if is_player_entering_tile(world, self.frame.x + 2, self.frame.y + 3) {
            vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::PvpArena)]
        } else {
            vec![]
        }        
    }
}

pub fn is_pvp_arena_available() -> bool {
    true  
}

impl Entity {
    pub fn is_pvp_arena_link(&self) -> bool {
        matches!(self.entity_type, EntityType::PvpArenaLink) | matches!(self.species_id, 1185)
    }
}