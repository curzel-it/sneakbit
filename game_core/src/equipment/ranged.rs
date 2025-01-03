use crate::{entities::bullets::make_player_bullet, features::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::has_species_in_inventory}, worlds::world::World};

use super::basics::{is_equipped, EquipmentUsageSoundEffect};

impl Entity {
    pub fn setup_ranged(&mut self) {
        self.setup_equipment();
    }

    pub fn update_ranged(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {           
        let mut updates: Vec<WorldStateUpdate> = vec![];

        self.is_equipped = is_equipped(&self.species, self.player_index);
        self.update_equipment_position(world);
        
        if self.is_equipped {
            updates.extend(self.attack_ranged(world, time_since_last_update));
            updates
        } else {
            vec![]
        }
    }

    fn attack_ranged(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let mut updates: Vec<WorldStateUpdate> = vec![];

        self.action_cooldown_remaining -= time_since_last_update;

        if self.action_cooldown_remaining > 0.0 {
            self.play_equipment_usage_animation();
            return updates
        }
        if world.players[self.player_index].has_ranged_attack_key_been_pressed {            
            let hero = world.players[self.player_index].props;

            if has_species_in_inventory(&self.species.bullet_species_id, self.player_index) {               
                self.action_cooldown_remaining = self.species.cooldown_after_use;
                self.sprite.reset();
                self.play_equipment_usage_animation();

                let mut bullet = make_player_bullet(self.parent_id, world, &self.species);
                bullet.dps *= self.species.ranged_dps_multiplier;
                bullet.direction = hero.direction;

                let mut updates = vec![
                    WorldStateUpdate::EngineUpdate(EngineStateUpdate::RemoveFromInventory(self.player_index, self.species.bullet_species_id)),
                    WorldStateUpdate::AddEntity(Box::new(bullet))
                ];

                if let Some(effect) = self.species.equipment_usage_sound_effect.clone() {
                    updates.push(effect.as_world_state_update(self.player_index));
                }
                return updates
            } else {
                updates.push(EquipmentUsageSoundEffect::NoAmmo.as_world_state_update(self.player_index));
            }
        }

        if self.sprite.completed_loops() >= 1 {
            self.update_sprite_for_current_state();
        }
        updates
    } 
}