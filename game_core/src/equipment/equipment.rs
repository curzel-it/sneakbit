use crate::{constants::TILE_SIZE, entities::known_species::{SPECIES_KUNAI_LAUNCHER, SPECIES_SWORD, SPECIES_SWORD_ITEM}, game_engine::{entity::Entity, state_updates::WorldStateUpdate, storage::inventory_count, world::World}, utils::directions::Direction};

impl Entity {
    pub fn setup_equipment(&mut self) {
        self.is_equipped = is_equipped(self.species_id);
        self.update_sprite_for_current_state();
    }

    pub fn update_equipment(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        self.update_equipment_position(world);
        self.update_sprite_for_current_state();
        vec![]
    }

    pub fn update_equipment_position(&mut self, world: &World) {   
        let hero = world.players[self.player_index].props;
        let is_being_used = self.action_cooldown_remaining > 0.0;
        self.direction = hero.direction;
        self.z_index = match (hero.direction, is_being_used) {
            (Direction::Left, false) => 14,
            (Direction::Right, false) => 14,
            (Direction::Down, false)  => 14,
            _ => 16
        };
        self.current_speed = hero.speed;
        self.frame.x = hero.frame.x;
        self.frame.y = hero.frame.y;
        self.offset.x = hero.offset.x - 1.5 * TILE_SIZE;
        self.offset.y = hero.offset.y - 1.0 * TILE_SIZE;
        self.update_sorting_key();
    }
}

pub fn is_equipped(species_id: u32) -> bool {
    match species_id {
        SPECIES_KUNAI_LAUNCHER => true,
        SPECIES_SWORD => inventory_count(&SPECIES_SWORD_ITEM) > 0,
        _ => false
    }        
}