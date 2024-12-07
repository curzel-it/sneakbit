use crate::{constants::{KUNAI_LAUNCHER_COOLDOWN, KUNAI_LIFESPAN}, entities::{bullets::make_hero_bullet, known_species::SPECIES_KUNAI}, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::has_species_in_inventory, world::World}};

impl Entity {
    pub fn setup_kunai_launcher(&mut self) {
        self.setup_equipment();
    }

    pub fn update_kunai_launcher(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        let mut updates: Vec<WorldStateUpdate> = vec![];
        updates.extend(self.update_equipment(world, time_since_last_update));
        updates.extend(self.fire(world, time_since_last_update));
        updates
    }

    fn fire(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        self.action_cooldown_remaining -= time_since_last_update;
        
        if self.action_cooldown_remaining > 0.0 {
            return vec![]
        }
        if !world.has_ranged_attack_key_been_pressed {
            return vec![]
        }
        if !has_species_in_inventory(&SPECIES_KUNAI) {
            return vec![]
        }

        self.action_cooldown_remaining = KUNAI_LAUNCHER_COOLDOWN;

        let bullet = make_hero_bullet(SPECIES_KUNAI, world, KUNAI_LIFESPAN);
        
        vec![
            WorldStateUpdate::EngineUpdate(EngineStateUpdate::RemoveFromInventory(SPECIES_KUNAI)),
            WorldStateUpdate::AddEntity(Box::new(bullet))
        ]
    } 
}