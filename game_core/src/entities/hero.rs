use crate::{game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World}, is_creative_mode};

use super::trails::leave_footsteps;

impl Entity {
    pub fn setup_hero(&mut self) {
        self.speed_multiplier = if is_creative_mode() { 2.0 } else { 1.0 };
    }

    pub fn update_hero(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {        
        let mut updates: Vec<WorldStateUpdate> = vec![];

        if !(world.is_hero_on_slippery_surface() && self.current_speed > 0.0) {
            self.update_direction(world);
            self.update_sprite_for_current_state();
        } else {
            self.update_sprite_for_direction_speed(self.direction, 0.0);
        }
        
        self.time_immobilized -= time_since_last_update;
        if self.time_immobilized <= 0.0 {
            self.move_linearly(world, time_since_last_update)
        }
        
        updates.push(self.cache_props());
        updates.push(self.move_camera_update());
        updates.extend(self.leave_footsteps(world));
        updates
    }

    fn cache_props(&self) -> WorldStateUpdate {
        WorldStateUpdate::CacheHeroProps(
            Box::new(self.props())
        )
    }

    fn move_camera_update(&self) -> WorldStateUpdate {
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::CenterCamera(
                self.frame.x, 
                self.frame.y,
                self.offset
            )
        )
    }
    
    fn leave_footsteps(&self, world: &World) -> Vec<WorldStateUpdate> {
        let previous = world.cached_hero_props.hittable_frame;
        let x = self.frame.x;
        let y = self.frame.y + 1;

        if previous.x != x || previous.y != y {
            leave_footsteps(world, &self.direction, x, y)
        } else {
            vec![]
        }
    }
}