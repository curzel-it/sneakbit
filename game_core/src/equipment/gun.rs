use crate::{entities::{bullets::make_player_bullet, known_species::SPECIES_KUNAI_LAUNCHER}, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, SpecialEffect, WorldStateUpdate}, storage::{decrease_inventory_count, has_species_in_inventory}, world::World}};

use super::equipment::is_equipped;

impl Entity {
    pub fn setup_gun(&mut self) {
        self.setup_equipment();
    }

    pub fn update_gun(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {           
        if matches!(self.id, SPECIES_KUNAI_LAUNCHER) {
            self.fire(world, time_since_last_update)
        } else {
            let mut updates: Vec<WorldStateUpdate> = vec![];

            self.is_equipped = is_equipped(&self.species, self.player_index);
            self.update_equipment_position(world);
            
            if self.is_equipped {
                updates.extend(self.fire(world, time_since_last_update));
                updates
            } else {
                vec![]
            }
        }
    }

    fn fire(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let mut updates: Vec<WorldStateUpdate> = vec![];

        self.action_cooldown_remaining -= time_since_last_update;

        if self.action_cooldown_remaining > 0.0 {
            self.play_equipment_usage_animation();
            return updates
        }
        if world.players[self.player_index].has_ranged_attack_key_been_pressed {            
            let hero = world.players[self.player_index].props;

            if has_species_in_inventory(&self.species.bullet_species_id, self.player_index) {               
                decrease_inventory_count(&self.species.bullet_species_id, self.player_index);

                self.action_cooldown_remaining = self.species.cooldown_after_use;
                self.sprite.reset();
                self.play_equipment_usage_animation();

                let mut bullet = make_player_bullet(self.parent_id, world, &self.species);
                bullet.direction = hero.direction;
                bullet.current_speed = bullet.current_speed + hero.speed;

                let mut updates = vec![WorldStateUpdate::AddEntity(Box::new(bullet))];

                if let Some(effect) = self.species.usage_special_effect.clone() {
                    updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(effect)));
                }

                return updates
            } else {
                updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(SpecialEffect::NoAmmo)))
            }
        }

        if self.sprite.completed_loops() >= 1 {
            self.update_sprite_for_current_state();
        }
        updates
    } 
}