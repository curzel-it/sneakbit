use crate::{constants::PLAYER1_INDEX, entities::known_species::is_building, features::{entity::{Entity, EntityId}, state_updates::WorldStateUpdate}, is_creative_mode, utils::{directions::Direction, rect::FRect, vector::Vector2d}, worlds::world::World};

use super::{pickable_object::object_pick_up_sequence, species::{species_by_id, Species, SpeciesId}};

pub type BulletId = EntityId;
pub type Damage = f32;

#[derive(Debug, Clone)]
pub struct BulletHits {
    pub bullet_id: BulletId,
    pub bullet_species_id: SpeciesId,
    pub bullet_parent_id: EntityId,
    pub target_ids: Vec<EntityId>,
    pub damage: f32,
    pub supports_catching: bool,
    pub supports_bullet_boomerang: bool
}

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

        if self.current_speed == 0.0 && !is_creative_mode() {   
            if let Some(player) = world.first_index_of_player_in(&self.hittable_frame()) {
                return object_pick_up_sequence(player, self);
            }            
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
        let exclude = vec![0, self.id, self.parent_id];
        let valid_hits: Vec<u32> = world
            .entity_ids_by_area(&exclude, &self.hittable_frame())
            .into_iter()
            .map(|(entity_id, _)| entity_id)
            .collect();

        if valid_hits.is_empty() {
            return vec![]
        }

        let damage = self.dps * time_since_last_update;

        vec![
            WorldStateUpdate::HandleHits(
                BulletHits { 
                    bullet_id: self.id, 
                    bullet_species_id: self.species_id,
                    bullet_parent_id: self.parent_id,
                    target_ids: valid_hits, 
                    supports_catching: self.species.supports_bullet_catching, 
                    supports_bullet_boomerang: self.species.supports_bullet_boomerang, 
                    damage 
                }
            )
        ]
    }

    fn check_stoppers(&self, world: &World) -> Vec<WorldStateUpdate> {
        let construction = &world.construction_at(self.frame.x, self.frame.y);
        let biome = &world.biome_at(self.frame.x, self.frame.y);
        let hits = world.entity_ids(self.frame.x, self.frame.y);

        if construction.stops_bullets() || biome.stops_bullets() {
            return vec![WorldStateUpdate::HandleBulletStopped(self.id)]
        }
        if hits.iter().any(|(_, species_id)| is_building(*species_id)) {
            return vec![WorldStateUpdate::HandleBulletStopped(self.id)]
        }
        if hits.iter().any(|(entity_id, _)| *entity_id == self.parent_id) {
            return vec![WorldStateUpdate::HandleBulletCatched(self.id)]
        }
        vec![]
    }

    pub fn is_valid_hit_target(&self, entity_id: u32) -> bool {
        entity_id != 0 && entity_id != self.id && entity_id != self.parent_id 
    }
}

pub fn make_bullet_ex(
    species: u32, 
    parent_id: u32, 
    center: &Vector2d, 
    direction: Direction, 
    lifespan: f32
) -> Entity {
    let (dx, dy) = direction.as_offset();
    let mut bullet = species_by_id(species).make_entity();
    bullet.direction = direction;
    bullet.frame = FRect::new(
        center.x - bullet.frame.w / 2.0 + dx / 4.0, 
        center.y - bullet.frame.h / 2.0 + dy / 4.0, 
        bullet.frame.w, 
        bullet.frame.h
    );
    
    bullet.parent_id = parent_id;
    bullet.remaining_lifespan = lifespan;
    bullet.reset_speed();
    bullet
}

pub fn make_player_bullet(parent_id: u32, world: &World, weapon_species: &Species) -> Entity {
    let index = world.player_index_by_entity_id(parent_id).unwrap_or(PLAYER1_INDEX);
    let player = world.players[index].props;

    let mut bullet = make_bullet_ex(
        weapon_species.bullet_species_id,
        parent_id,
        &player.hittable_frame.center(),
        player.direction,
        weapon_species.bullet_lifespan
    );
    bullet.player_index = index;
    bullet
}