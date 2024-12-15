use crate::{constants::STEP_COMMITMENT_THRESHOLD, game_engine::entity::Entity, utils::{directions::Direction, vector::Vector2d}};

impl Entity {
    pub fn update_direction_for_current_keys(&mut self, new_direction: Direction) {
        let current_direction = self.direction;
        
        if self.reset_offset_on_next_direction_change && new_direction != Direction::Unknown {
            self.reset_offset_on_next_direction_change = false;
            self.offset = Vector2d::zero();
        }

        if self.offset.x.abs() < STEP_COMMITMENT_THRESHOLD && self.offset.y.abs() < STEP_COMMITMENT_THRESHOLD {
            if new_direction != Direction::Unknown {
                self.reset_speed();
                self.direction = new_direction;
            } else {
                self.current_speed = 0.0;
            }
        } else {
            self.direction = current_direction;
        }
    }
}