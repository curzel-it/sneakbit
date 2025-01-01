use crate::{entities::species::EntityType, features::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}}, utils::rect::FRect, worlds::world::World};

impl Entity {
    pub fn setup_pvp_arena(&mut self) {
        self.is_rigid = true;
    }

    pub fn update_pvp_arena(&mut self, world: &World) -> Vec<WorldStateUpdate> {   
        let player = world.players[0].props;
        let is_near_entrance = player.hittable_frame.is_around_and_pointed_at(&self.pvp_entrance(), &player.direction);
        let is_moving = player.speed > 0.0;

        if is_near_entrance && is_moving {
            vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::PvpArena)]
        } else {
            vec![]
        }        
    }

    fn pvp_entrance(&self) -> FRect {
        FRect {
            x: self.frame.x + 2.0,
            y: self.frame.y + 3.0,
            w: 1.0,
            h: 1.0
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