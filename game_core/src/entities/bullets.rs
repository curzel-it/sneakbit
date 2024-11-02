use crate::{game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, utils::directions::Direction};

use super::pickable_object::object_pick_up_sequence;

impl Entity {
    pub fn setup_bullet(&mut self) {
        // ...
    }  

    pub fn update_bullet(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        self.update_sprite_for_current_state();
        self.move_linearly(world, time_since_last_update);

        if self.is_at_the_edge_of_the_world(&world.bounds) {
            return vec![WorldStateUpdate::RemoveEntity(self.id)]
        }

        if self.current_speed == 0.0 && !world.creative_mode && world.is_hero_at(self.frame.x, self.frame.y) {   
            return object_pick_up_sequence(self);
        }

        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown) {
            return vec![]
        }

        let updates = self.check_stoppers(world);
        if !updates.is_empty() {
            return updates
        }
        self.check_hits(world)
    }

    fn check_hits(&self, world: &World) -> Vec<WorldStateUpdate> {
        let hit = world.entities_map[self.frame.y as usize][self.frame.x as usize];
        if self.is_valid_hit_target(hit) { 
            return vec![WorldStateUpdate::HandleHit(self.id, hit)]
        }

        let (previous_x, previous_y) = self.previous_position();
        let hit = world.entities_map[previous_y as usize][previous_x as usize];
        if self.is_valid_hit_target(hit) { 
            return vec![WorldStateUpdate::HandleHit(self.id, hit)]
        }

        vec![]
    }

    fn check_stoppers(&self, world: &World) -> Vec<WorldStateUpdate> {
        if self.frame.x < 0 { return vec![] }
        if self.frame.x as usize >= world.constructions_tiles.tiles[0].len() { return vec![] }
        if self.frame.y < 0 { return vec![] }
        if self.frame.y as usize >= world.constructions_tiles.tiles.len() { return vec![] }
        
        let construction = world.constructions_tiles.tiles[self.frame.y as usize][self.frame.x as usize];
        let hit = world.entities_map[self.frame.y as usize][self.frame.x as usize];

        if construction.tile_type.stops_bullets() || world.is_building(hit) {
            return vec![WorldStateUpdate::RemoveEntity(self.id)]
        }
        vec![]
    }

    pub fn is_valid_hit_target(&self, hit: u32) -> bool {
        hit != 0 && hit != self.id && hit != self.parent_id 
    }

    fn previous_position(&self) -> (i32, i32) {
        let (ox, oy) = self.direction.as_col_row_offset();
        (self.frame.x - ox, self.frame.y - oy)
    } 
}