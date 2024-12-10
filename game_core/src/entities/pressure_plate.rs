use crate::{constants::PRESSURE_PLATE_SWITCH_COOLDOWN, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}};

impl Entity {
    pub fn setup_pressure_plate(&mut self) {
        // ...
    }
  
    pub fn update_pressure_plate(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        self.action_cooldown_remaining -= time_since_last_update;
        if self.action_cooldown_remaining > 0.0 {
            return vec![]
        }

        let hero_on_it = world.is_any_hero_at(self.frame.x, self.frame.y);
        let weight_on_it = world.has_weight(self.frame.x, self.frame.y);
        let is_being_pressed_down = hero_on_it || weight_on_it;
        let is_up = world.is_pressure_plate_up(&self.lock_type);

        if is_up && is_being_pressed_down {
            self.action_cooldown_remaining = PRESSURE_PLATE_SWITCH_COOLDOWN;
            self.sprite.frame.x = self.original_sprite_frame.x + 1;
            vec![WorldStateUpdate::SetPressurePlateState(self.lock_type, true)]
        } else if !is_up && !is_being_pressed_down {
            self.action_cooldown_remaining = PRESSURE_PLATE_SWITCH_COOLDOWN;
            self.sprite.frame.x = self.original_sprite_frame.x;
            vec![WorldStateUpdate::SetPressurePlateState(self.lock_type, false)]
        } else {
            vec![]
        }
    }
}