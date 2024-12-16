use crate::{features::{entity::Entity, state_updates::WorldStateUpdate}, worlds::world::World};

impl Entity {
    pub fn update_building(&mut self, _: &World, _: f32) -> Vec<WorldStateUpdate> {  
        vec![]
    }
}