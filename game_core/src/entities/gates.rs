use crate::game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World};

impl Entity {
    pub fn setup_gate(&mut self, creative_mode: bool) {
        if creative_mode {
            self.is_rigid = false;
        }
    }  

    pub fn update_gate(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.creative_mode && world.is_hero_interacting(&self.frame) {
            return vec![
                WorldStateUpdate::EngineUpdate(
                    EngineStateUpdate::ShowEntityOptions(
                        Box::new(self.clone())
                    )
                )
            ];   
        }

        if world.is_pressure_plate_up(&self.lock_type) {
            self.is_rigid = !world.creative_mode;
            self.sprite.frame.x = self.original_sprite_frame.x;
        } else {
            self.is_rigid = false;
            self.sprite.frame.x = self.original_sprite_frame.x + 1;
        }

        vec![]
    }
}

impl Entity {
    pub fn setup_inverse_gate(&mut self, creative_mode: bool) {
        if creative_mode {
            self.is_rigid = false;
        }
    }  

    pub fn update_inverse_gate(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.creative_mode && world.is_hero_interacting(&self.frame) {
            return vec![
                WorldStateUpdate::EngineUpdate(
                    EngineStateUpdate::ShowEntityOptions(
                        Box::new(self.clone())
                    )
                )
            ];   
        }

        if world.is_pressure_plate_down(&self.lock_type) {
            self.is_rigid = !world.creative_mode;
            self.sprite.frame.x = self.original_sprite_frame.x;
        } else {
            self.is_rigid = false;
            self.sprite.frame.x = self.original_sprite_frame.x + 1;
        }

        vec![]
    }
}