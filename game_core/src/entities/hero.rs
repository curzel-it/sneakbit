use crate::{constants::HERO_RECOVERY_PS, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, is_creative_mode};

use super::trails::leave_footsteps;

impl Entity {
    pub fn setup_hero(&mut self) {
        self.speed_multiplier = if is_creative_mode() { 2.0 } else { 1.0 };
    }

    pub fn update_hero(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {        
        let mut updates: Vec<WorldStateUpdate> = vec![];
        let is_slipping = world.frame_is_slippery_surface(&self.hittable_frame());

        if !(is_slipping && self.current_speed > 0.0) {
            self.update_direction(world);
            self.update_sprite_for_current_state();
        } else {
            self.update_sprite_for_direction_speed(self.direction, 0.0);
        }
        
        self.time_immobilized -= time_since_last_update;
        if self.time_immobilized <= 0.0 {
            self.move_linearly(world, time_since_last_update)
        }
        if self.hp < 100.0 {
            self.hp += HERO_RECOVERY_PS * time_since_last_update
        }
        
        updates.push(self.cache_props());
        updates.extend(self.leave_footsteps(world));
        updates
    }

    pub fn setup_hero_with_player_index(&mut self, player_index: usize) {
        self.player_index = player_index;


        let (x, y) = match player_index {
            1 => (36, 38),
            2 => (40, 38),
            3 => (44, 38),
            _ => (12, 0),
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
        let previous = world.players[0].props.hittable_frame;
        let x = self.frame.x;
        let y = self.frame.y + 1;

        if previous.x != x || previous.y != y {
            leave_footsteps(world, &self.direction, x, y)
        } else {
            vec![]
        }
    }
}