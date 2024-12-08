use crate::{constants::{CLAYMORE_SLASH_COOLDOWN, CLAYMORE_SLASH_LIFESPAN, SWORD_SLASH_COOLDOWN, SWORD_SLASH_LIFESPAN}, entities::{bullets::make_hero_bullet, known_species::{SPECIES_CLAYMORE, SPECIES_CLAYMORE_SLASH, SPECIES_SWORD_SLASH}, species::SpeciesId}, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, SpecialEffect, WorldStateUpdate}, world::World}, utils::{directions::Direction, vector::Vector2d}};

use super::equipment::is_equipped;


impl Entity {
    pub fn setup_sword(&mut self) {
        self.setup_equipment();
    }

    pub fn update_sword(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        let mut updates: Vec<WorldStateUpdate> = vec![];

        self.is_equipped = is_equipped(self.species_id);
        self.update_equipment_position(world);
        
        if self.is_equipped {
            updates.extend(self.slash(world, time_since_last_update));
            updates
        } else {
            vec![]
        }
    }

    fn slash(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        self.action_cooldown_remaining -= time_since_last_update;
        
        if self.action_cooldown_remaining > 0.0 {
            self.sprite.frame.y = slash_sprite_y_for_direction(&self.direction);
            return vec![]
        }
        if world.has_close_attack_key_been_pressed {
            let hero = world.cached_hero_props;
            let config = slash_config_by_sword_type(self.species_id);
            let offsets = bullet_offsets(world.cached_hero_props.direction);

            self.action_cooldown_remaining = config.cooldown;
            self.sprite.reset();
            self.sprite.frame.y = slash_sprite_y_for_direction(&self.direction);            

            let mut updates: Vec<WorldStateUpdate> = offsets.into_iter()
                .map(|(dx, dy)| {
                    let mut bullet = make_hero_bullet(config.species, world, config.lifespan);
                    bullet.offset = Vector2d::zero();
                    bullet.frame = hero.hittable_frame.offset_by((dx, dy)); 
                    WorldStateUpdate::AddEntity(Box::new(bullet))
                })
                .collect();

            updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(config.effect)));

            return updates
        }
        self.update_sprite_for_current_state();

        vec![]
    } 
}

struct SlashConfig {
    cooldown: f32,
    species: SpeciesId,
    lifespan: f32,
    effect: SpecialEffect
}

fn slash_config_by_sword_type(sword_species_id: SpeciesId) -> SlashConfig {
    match sword_species_id {
        SPECIES_CLAYMORE => SlashConfig { 
            cooldown: CLAYMORE_SLASH_COOLDOWN, 
            species: SPECIES_CLAYMORE_SLASH, 
            lifespan: CLAYMORE_SLASH_LIFESPAN,
            effect: SpecialEffect::ClaymoreSlash
        },
        _ => SlashConfig { 
            cooldown: SWORD_SLASH_COOLDOWN, 
            species: SPECIES_SWORD_SLASH, 
            lifespan: SWORD_SLASH_LIFESPAN,
            effect: SpecialEffect::SwordSlash
        }
    }
}

fn slash_sprite_y_for_direction(direction: &Direction) -> i32 {
    match direction {
        Direction::Up => 37,
        Direction::Down => 45,
        Direction::Right => 41,
        Direction::Left => 49,
        Direction::Unknown => 37,
        Direction::Still => 37,
    }
}

fn bullet_offsets(direction: Direction) -> Vec<(i32, i32)> {
    match direction {
        Direction::Up => vec![
            (-1, -1), (0, -2), (0, -1), (1, -1)
        ],
        Direction::Down | Direction::Unknown | Direction::Still => vec![
            (-1, 1), (0, 2), (0, 1), (1, 1)
        ],
        Direction::Right => vec![
            (1, -1), (2, 0), (1, 0), (1, 1)
        ],
        Direction::Left => vec![
            (-1, -1), (-2, 0), (-1, 0), (-1, 1)
        ],
    }
}