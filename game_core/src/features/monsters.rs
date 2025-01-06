use crate::{entities::{bullets::BulletHits, known_species::{is_monster, SPECIES_MONSTER, SPECIES_MONSTER_BLUEBERRY, SPECIES_MONSTER_GOOSEBERRY, SPECIES_MONSTER_SMALL, SPECIES_MONSTER_STRAWBERRY}, species::{species_by_id, EntityType}}, features::{entity::Entity, state_updates::WorldStateUpdate}, is_creative_mode, worlds::world::World};

impl Entity {
    pub fn setup_monster(&mut self) {
        self.update_sprite_for_current_state();
    }

    pub fn update_monster(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> { 
        self.update_sprite_for_current_state();
        
        if !is_creative_mode() {            
            let updates = self.handle_melee_attack(world, time_since_last_update);                
            if !updates.is_empty() {
                return updates;
            }

            let updates = self.fuse_with_other_creeps_if_possible(world);
            if !updates.is_empty() {
                return updates;
            }
        }
        vec![]
    }
}

impl Entity {
    pub fn melee_attacks_hero(&self) -> bool {
        matches!(self.entity_type, EntityType::CloseCombatMonster)
    }
}

impl Entity {
    fn handle_melee_attack(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        if self.is_dying || is_creative_mode() {
            return vec![]
        }
        if world.players[0].props.is_invulnerable {
            return vec![]
        }
        let players_being_hit = world.entity_ids_of_all_players_in(&self.hittable_frame());
           
        if !players_being_hit.is_empty() {
            let damage = self.dps * time_since_last_update;
            let hits = BulletHits {
                bullet_id: self.id,
                bullet_species_id: self.species_id,
                bullet_parent_id: self.id,
                target_ids: players_being_hit,
                damage,
                supports_catching: false,
                supports_bullet_boomerang: false,
            };
            return vec![WorldStateUpdate::HandleHits(hits)];
        }
        vec![]
    }
    
    fn fuse_with_other_creeps_if_possible(&mut self, world: &World) -> Vec<WorldStateUpdate> {
        if !is_monster(self.species_id) {
            return vec![]
        }
        if self.is_dying {
            return vec![]
        }
        if let Some(next_species_id) = next_species_id(self.species_id) {
            let exclude = vec![0, self.id, self.parent_id];
            let compatible_monster = world
                .entity_ids_by_area(&exclude, &self.hittable_frame())
                .into_iter()
                .find(|&(entity_id, species_id)| {
                    is_monster(species_id) && species_id <= self.species_id && entity_id <= self.id
                });

            if let Some((entity_id, _)) = compatible_monster {
                let next_species = species_by_id(next_species_id);
                self.species_id = next_species.id;
                self.species = next_species.clone();
                next_species.reload_props(self);
                return vec![WorldStateUpdate::RemoveEntity(entity_id)]
            }
        }
        vec![]
    }
}

fn next_species_id(current_species_id: u32) -> Option<u32> {
    match current_species_id {
        SPECIES_MONSTER_SMALL => Some(SPECIES_MONSTER_BLUEBERRY),
        SPECIES_MONSTER => Some(SPECIES_MONSTER_BLUEBERRY),
        SPECIES_MONSTER_BLUEBERRY => Some(SPECIES_MONSTER_STRAWBERRY),
        SPECIES_MONSTER_STRAWBERRY => Some(SPECIES_MONSTER_GOOSEBERRY),
        _ => None,
    }
}