use crate::{constants::SPRITE_SHEET_MONSTERS, entities::{bullets::BulletHits, known_species::is_monster, species::EntityType}, features::{animated_sprite::AnimatedSprite, entity::Entity, state_updates::WorldStateUpdate}, is_creative_mode, utils::rect::IntRect, worlds::world::World};

impl Entity {
    pub fn setup_close_combat_creep(&mut self) {
        self.update_sprite_for_current_state();
    }

    pub fn update_close_combat_creep(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> { 
        self.update_sprite_for_current_state();
        
        if !is_creative_mode() {
            self.update_direction(world);
            self.move_linearly(world, time_since_last_update);
            
            let updates = self.handle_melee_attack(world, time_since_last_update);                
            if !updates.is_empty() {
                return updates
            }

            let updates = self.fuse_with_other_creeps_if_possible(world);
            if !updates.is_empty() {
                return updates
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

        let frame = self.hittable_frame();     
        let players_being_hit = world.entity_ids_of_all_players_at(frame.x, frame.y);
           
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

        let hits = world.entity_ids(self.frame.x, self.frame.y);

        for hit in hits {        
            if self.is_valid_hit_target(hit) && world.is_creep(hit) {
                self.sprite = next_sprite(self.sprite.original_frame.x);
                self.hp = hp_for_sprite(self.sprite.original_frame.x);
                self.dps = dps_for_sprite(self.sprite.original_frame.x);
                self.current_speed *= 1.1;
                return vec![WorldStateUpdate::RemoveEntity(hit)]
            }
        }
        vec![]
    }
}

fn next_sprite(current_sprite_x: i32) -> AnimatedSprite {
    let (x, y) = match current_sprite_x {
        1 => (5, 1),
        5 => (9, 1),
        9 => (13, 1),
        13 => (13, 1),
        _ => (13, 1)
    };
    AnimatedSprite::new(
        SPRITE_SHEET_MONSTERS, 
        IntRect::new(x, y, 1, 2), 
        4
    )
}

fn hp_for_sprite(current_sprite_x: i32) -> f32 {
    match current_sprite_x {
        1 => 200.0,
        5 => 600.0,
        9 => 1300.0,
        13 => 2000.0,
        _ => 200.0
    }
}

fn dps_for_sprite(current_sprite_x: i32) -> f32 {
    match current_sprite_x {
        1 => 400.0,
        5 => 500.0,
        9 => 600.0,
        13 => 700.0,
        _ => 400.0
    }
}