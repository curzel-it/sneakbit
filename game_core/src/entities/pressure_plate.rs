use crate::game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World};

impl Entity {
    pub fn setup_pressure_plate(&mut self) {
        // ...
    }
  
    pub fn update_pressure_plate(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.creative_mode && world.is_hero_around_and_on_collision_with(&self.frame) {
            return vec![
                WorldStateUpdate::EngineUpdate(
                    EngineStateUpdate::ShowEntityOptions(
                        Box::new(self.clone())
                    )
                )
            ];   
        }

        let hero_on_it = world.is_hero_at(self.frame.x, self.frame.y);
        let weight_on_it = world.weights_map[self.frame.y as usize][self.frame.x as usize] > 0;
        let is_being_pressed_down = hero_on_it || weight_on_it;
        let is_up = world.is_pressure_plate_up(&self.lock_type);

        if is_up && is_being_pressed_down {
            self.sprite.frame.x = self.original_sprite_frame.x + 1;
            vec![WorldStateUpdate::SetPressurePlateState(self.lock_type, true)]
        } else if !is_up && !is_being_pressed_down {
            self.sprite.frame.x = self.original_sprite_frame.x;
            vec![WorldStateUpdate::SetPressurePlateState(self.lock_type, false)]
        } else {
            vec![]
        }
    }
}