use crate::game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World};

impl Entity {
    pub fn update_building(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.creative_mode && world.is_hero_interacting(&self.frame) {
            let hero_x = world.cached_hero_props.hittable_frame.x;
            let hero_y = world.cached_hero_props.hittable_frame.y;            
            let is_touching_door = hero_x == self.frame.x + self.frame.w - 2 && hero_y == self.frame.y + self.frame.h;

            if !is_touching_door {
                return vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::ShowEntityOptions(
                            Box::new(self.clone())
                        )
                    )
                ];   
            }
        }
        vec![]
    }
}