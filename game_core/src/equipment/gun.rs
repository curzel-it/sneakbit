use crate::{entities::{bullets::make_player_bullet, known_species::SPECIES_KUNAI_LAUNCHER, species::species_by_id}, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, SpecialEffect, WorldStateUpdate}, storage::{decrease_inventory_count, has_species_in_inventory}, world::World}};

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

            self.is_equipped = is_equipped(self.species_id);
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
        if world.players[self.player_index].has_close_attack_key_been_pressed {            
            let hero = world.players[self.player_index].props;
            let species = species_by_id(self.species_id);

            if has_species_in_inventory(&species.bullet_species_id) {               
                decrease_inventory_count(&species.bullet_species_id);

                self.action_cooldown_remaining = species.cooldown_after_use;
                self.sprite.reset();
                self.play_equipment_usage_animation();

                let mut bullet = make_player_bullet(self.parent_id, world, &species);
                bullet.direction = hero.direction;
                bullet.current_speed = bullet.current_speed + hero.speed;

                let mut updates = vec![WorldStateUpdate::AddEntity(Box::new(bullet))];

                if let Some(effect) = species.usage_special_effect {
                    updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(effect)));
                }

                return updates
            } else {
                updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(SpecialEffect::NoAmmo)))
            }
        }

        if self.sprite.completed_loops() >= 1 {
            self.update_sprite_for_current_state();
        } else {
            self.sprite.update(time_since_last_update);
        }
        updates
    } 
}

/*
impl Entity {
    pub fn setup_gun(&mut self) {
        self.setup_equipment();
    }

    pub fn update_gun(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        let mut updates: Vec<WorldStateUpdate> = vec![];
        updates.extend(self.update_equipment(world, time_since_last_update));
        updates.extend(self.fire(world, time_since_last_update));
        updates
    }

    fn fire(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        self.action_cooldown_remaining -= time_since_last_update;
        if self.action_cooldown_remaining > 0.0 {
            self.play_equipment_usage_animation();
            return vec![]
        }
        if !world.players[self.player_index].has_ranged_attack_key_been_pressed {
            self.update_sprite_for_current_state();
            return vec![]
        }

        let species = species_by_id(self.species_id);
        let bullet_species = species.bullet_species_id;

        if !has_species_in_inventory(&bullet_species) {
            return vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(SpecialEffect::NoAmmo))]
        }
        
        self.action_cooldown_remaining = species.cooldown_after_use;
        self.sprite.reset();
        self.play_equipment_usage_animation();

        let bullet = make_player_bullet(self.parent_id, world, &species);
        let mut updates = vec![
            WorldStateUpdate::EngineUpdate(EngineStateUpdate::RemoveFromInventory(bullet_species)),
            WorldStateUpdate::AddEntity(Box::new(bullet))
        ];

        if let Some(effect) = species.usage_special_effect {
            updates.push(WorldStateUpdate::EngineUpdate(EngineStateUpdate::SpecialEffect(effect)));
        }

        updates
    } 
} */