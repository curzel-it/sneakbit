use crate::{features::{entity::Entity, state_updates::WorldStateUpdate}, is_creative_mode, worlds::world::World};

impl Entity {
    pub fn setup_gate(&mut self) {
        if is_creative_mode() {
            self.is_rigid = false;
        }
    }  

    pub fn update_gate(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.is_pressure_plate_up(&self.lock_type) {
            self.is_rigid = !is_creative_mode();
            self.sprite.frame.x = self.original_sprite_frame.x;
        } else {
            self.is_rigid = false;
            self.sprite.frame.x = self.original_sprite_frame.x + 1.0;
        }

        vec![]
    }
}

impl Entity {
    pub fn setup_inverse_gate(&mut self) {
        if is_creative_mode() {
            self.is_rigid = false;
        }
    }  

    pub fn update_inverse_gate(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.is_pressure_plate_down(&self.lock_type) {
            self.is_rigid = !is_creative_mode();
            self.sprite.frame.x = self.original_sprite_frame.x;
        } else {
            self.is_rigid = false;
            self.sprite.frame.x = self.original_sprite_frame.x + 1.0;
        }

        vec![]
    }
}