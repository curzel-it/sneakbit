use crate::{constants::{HERO_ENTITY_ID, TILE_SIZE}, game_engine::{entity::{Entity, EntityId}, state_updates::WorldStateUpdate, world::World}, is_creative_mode, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

use super::{pickable_object::object_pick_up_sequence, species::species_by_id};

pub type BulletId = EntityId;
pub type Damage = f32;

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

        if self.current_speed == 0.0 && !is_creative_mode() && world.is_hero_at(self.frame.x, self.frame.y) {   
            return object_pick_up_sequence(self);
        }

        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown) {
            return vec![]
        }

        let updates = self.check_stoppers(world);
        if !updates.is_empty() {
            return updates
        }
        self.check_hits(world, time_since_last_update)
    }

    fn check_hits(&self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let (previous_x, previous_y) = self.previous_position();
        let previous_hits = world.entities_map[previous_y as usize][previous_x as usize].to_owned();
        let current_hits = world.entities_map[self.frame.y as usize][self.frame.x as usize].to_owned();

        let valid_hits: Vec<u32> = vec![previous_hits, current_hits]
            .into_iter()
            .flat_map(|id| id)
            .filter(|id| self.is_valid_hit_target(*id))
            .collect();

        let damage = self.dps * time_since_last_update;

        vec![WorldStateUpdate::HandleHits(self.id, valid_hits, damage)]
    }

    fn check_stoppers(&self, world: &World) -> Vec<WorldStateUpdate> {
        if self.frame.x < 0 { return vec![] }
        if self.frame.x as usize >= world.constructions_tiles.tiles[0].len() { return vec![] }
        if self.frame.y < 0 { return vec![] }
        if self.frame.y as usize >= world.constructions_tiles.tiles.len() { return vec![] }
        
        let construction = &world.constructions_tiles.tiles[self.frame.y as usize][self.frame.x as usize];
        let biome = &world.biome_tiles.tiles[self.frame.y as usize][self.frame.x as usize];
        let hits = world.entities_map[self.frame.y as usize][self.frame.x as usize].to_owned();

        if construction.tile_type.stops_bullets() || biome.tile_type.stops_bullets() || world.contains_building(&hits) {
            return vec![WorldStateUpdate::HandleBulletStopped(self.id)]
        }
        if hits.contains(&self.parent_id) {
            return vec![WorldStateUpdate::HandleBulletCatched(self.id)]
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

fn make_bullet_ex(
    species: u32, 
    parent_id: u32, 
    starting_frame: &IntRect, 
    starting_offset: &Vector2d, 
    direction: Direction, 
    lifespan: f32
) -> Entity {
    let mut bullet = species_by_id(species).make_entity();
    bullet.direction = direction;
    let (dx, dy) = direction.as_col_row_offset();
    bullet.frame = starting_frame.offset(dx, dy); 
    
    if starting_offset.x > TILE_SIZE / 2.0 { bullet.frame.x += 1 }
    if starting_offset.x < -TILE_SIZE / 2.0 { bullet.frame.x -= 1 }
    if starting_offset.y > TILE_SIZE / 2.0 { bullet.frame.y += 1 }
    if starting_offset.y < -TILE_SIZE / 2.0 { bullet.frame.y -= 1 }
    
    bullet.parent_id = parent_id;
    bullet.remaining_lifespan = lifespan;
    bullet.reset_speed();
    bullet
}

pub fn make_hero_bullet(species: u32, world: &World, lifespan: f32) -> Entity {
    let hero = world.cached_hero_props;
    make_bullet_ex(
        species,
        HERO_ENTITY_ID,
        &hero.hittable_frame,
        &hero.offset,
        hero.direction,
        lifespan
    )
}
