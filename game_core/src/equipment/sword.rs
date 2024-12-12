use crate::{entities::{bullets::make_player_bullet, species::species_by_id}, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World}, utils::{directions::Direction, vector::Vector2d}};

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
        if world.players[self.player_index].has_close_attack_key_been_pressed {
            let hero = world.players[self.player_index].props;
            let species = species_by_id(self.species_id);
            let offsets = bullet_offsets(world.players[self.player_index].props.direction);

            self.action_cooldown_remaining = species.cooldown_after_use;
            self.sprite.reset();
            self.sprite.frame.y = slash_sprite_y_for_direction(&self.direction);            

            let mut updates: Vec<WorldStateUpdate> = offsets.into_iter()
                .map(|(dx, dy)| {
                    let mut bullet = make_player_bullet(self.parent_id, world, &species);
                    bullet.offset = Vector2d::zero();
                    bullet.frame = hero.hittable_frame.offset_by((dx, dy)); 
                    bullet.direction = hero.direction;
                    bullet.current_speed = bullet.current_speed + hero.speed;
                    WorldStateUpdate::AddEntity(Box::new(bullet))
                })
                .collect();

            if let Some(effect) = species.usage_special_effect {
                updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(effect)));
            }

            return updates
        }
        self.update_sprite_for_current_state();

        vec![]
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