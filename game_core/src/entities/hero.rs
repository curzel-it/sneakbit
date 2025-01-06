use crate::{constants::HERO_RECOVERY_PS, features::{entity::Entity, state_updates::WorldStateUpdate}, is_creative_mode, utils::vector::Vector2d, worlds::world::World};

use super::trails::leave_footsteps;

impl Entity {
    pub fn setup_hero(&mut self) {
        self.speed_multiplier = if is_creative_mode() { 2.0 } else { 1.0 };
    }

    pub fn update_hero(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {        
        let mut updates: Vec<WorldStateUpdate> = vec![];

        self.update_sprite_for_current_state();        
        self.self_heal(time_since_last_update);
        
        updates.push(self.cache_props());
        updates.extend(self.leave_footsteps(world));
        updates
    }

    pub fn setup_hero_with_player_index(&mut self, player_index: usize) {
        self.player_index = player_index;
        self.direction = Vector2d::zero();
        self.reset_offset_on_next_direction_change = true;

        let (x, y) = match player_index {
            1 => (5.0, 1.0),
            2 => (9.0, 1.0),
            3 => (13.0, 1.0),
            _ => (1.0, 1.0),
        };
        println!("Player #{}, sprite x {} y {}", self.player_index, x, y);
        self.sprite.original_frame.x = x;
        self.sprite.original_frame.y = y;
        self.sprite.reset();
    }

    fn cache_props(&self) -> WorldStateUpdate {
        WorldStateUpdate::CacheHeroProps(
            Box::new(self.props())
        )
    }
    
    fn leave_footsteps(&self, world: &World) -> Vec<WorldStateUpdate> {
        let previous = world.players[self.player_index].props.hittable_frame.center();
        let previous_x = previous.x.floor() as i32;
        let previous_y = previous.y.floor() as i32;

        let current = self.hittable_frame().center();
        let current_x = current.x.floor() as i32;
        let current_y = current.y.floor() as i32;

        if previous_x != current_x || previous_y != current_y {
            leave_footsteps(world, &self.direction, self.frame.x, self.frame.y + 1.0)
        } else {
            vec![]
        }
    }

    fn self_heal(&mut self, time_since_last_update: f32) {
        if self.hp < 100.0 {
            self.hp += HERO_RECOVERY_PS * time_since_last_update
        }
    }
}