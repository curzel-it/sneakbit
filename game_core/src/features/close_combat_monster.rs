use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, entities::{known_species::is_monster, species::EntityType}, features::animated_sprite::AnimatedSprite, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, is_creative_mode, utils::rect::IntRect};

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

        let hero_invulnerable = world.cached_hero_props.is_invulnerable;
        let hero = world.cached_hero_props.hittable_frame;
        let x = self.frame.x;
        let y = self.frame.y + if self.frame.h > 1 { 1 } else { 0 };
        
        if x == hero.x && y == hero.y && !hero_invulnerable {
            let damage = self.dps * time_since_last_update;
            return vec![WorldStateUpdate::HandleHeroDamage(damage)];
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
                return vec![WorldStateUpdate::RemoveEntity(hit)]
            }
        }
        vec![]
    }
}

fn next_sprite(current_sprite_x: i32) -> AnimatedSprite {
    let (x, y) = match current_sprite_x {
        28 => (44, 0),
        44 => (24, 38),
        24 => (32, 38),
        _ => (28, 0)
    };
    AnimatedSprite::new(
        SPRITE_SHEET_HUMANOIDS_1X2, 
        IntRect::new(x, y, 1, 2), 
        4
    )
}

fn hp_for_sprite(current_sprite_x: i32) -> f32 {
    match current_sprite_x {
        28 => 100.0,
        44 => 600.0,
        24 => 1300.0,
        32 => 2000.0,
        _ => 100.0
    }
}

fn dps_for_sprite(current_sprite_x: i32) -> f32 {
    match current_sprite_x {
        28 => 300.0,
        44 => 400.0,
        24 => 500.0,
        32 => 600.0,
        _ => 300.0
    }
}