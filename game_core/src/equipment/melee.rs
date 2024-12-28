use crate::{entities::bullets::make_player_bullet, features::{entity::Entity, state_updates::WorldStateUpdate}, utils::directions::Direction, worlds::world::World};

use super::basics::is_equipped;

impl Entity {
    pub fn setup_melee(&mut self) {
        self.setup_equipment();
    }

    pub fn update_melee(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        let mut updates: Vec<WorldStateUpdate> = vec![];

        self.is_equipped = is_equipped(&self.species, self.player_index);
        self.update_equipment_position(world);
        
        if self.is_equipped {
            updates.extend(self.attack_melee(world, time_since_last_update));
            updates
        } else {
            vec![]
        }
    }

    fn attack_melee(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        if self.species.bullet_species_id == 0 { 
            return vec![] 
        }
        self.action_cooldown_remaining -= time_since_last_update;

        if self.action_cooldown_remaining > 0.0 {
            self.play_equipment_usage_animation();
            return vec![]
        }
        if world.players[self.player_index].has_close_attack_key_been_pressed {
            let hero = world.players[self.player_index].props;
            let offsets = bullet_offsets(world.players[self.player_index].props.direction);

            self.action_cooldown_remaining = self.species.cooldown_after_use;
            self.sprite.reset();
            self.play_equipment_usage_animation();

            let mut updates: Vec<WorldStateUpdate> = offsets.into_iter()
                .map(|(dx, dy)| {
                    let mut bullet = make_player_bullet(self.parent_id, world, &self.species);
                    bullet.dps *= self.species.melee_dps_multiplier;
                    bullet.frame = hero.hittable_frame.offset_by((dx, dy)); 
                    bullet.direction = hero.direction;
                    bullet.current_speed += hero.speed;
                    WorldStateUpdate::AddEntity(Box::new(bullet))
                })
                .collect();

            if let Some(effect) = self.species.equipment_usage_sound_effect.clone() {
                updates.push(effect.as_world_state_update(self.player_index));
            }
            return updates
        }
        self.update_sprite_for_current_state();

        vec![]
    } 
}

fn bullet_offsets(direction: Direction) -> Vec<(f32, f32)> {
    match direction {
        Direction::Up => vec![
            (-1.0, -1.0), (0.0, -2.0), (0.0, -1.0), (1.0, -1.0)
        ],
        Direction::Down | Direction::Unknown | Direction::Still => vec![
            (-1.0, 1.0), (0.0, 2.0), (0.0, 1.0), (1.0, 1.0)
        ],
        Direction::Right => vec![
            (1.0, -1.0), (2.0, 0.0), (1.0, 0.0), (1.0, 1.0)
        ],
        Direction::Left => vec![
            (-1.0, -1.0), (-2.0, 0.0), (-1.0, 0.0), (-1.0, 1.0)
        ],
    }
}