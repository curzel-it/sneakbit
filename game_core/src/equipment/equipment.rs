use crate::{constants::TILE_SIZE, entities::{known_species::SPECIES_KUNAI_LAUNCHER, species::{species_by_id, EntityType, Species, ALL_SPECIES}}, game_engine::{entity::Entity, state_updates::WorldStateUpdate, storage::{get_value_for_global_key, has_species_in_inventory, set_value_for_key, StorageKey}, world::World}, utils::directions::Direction};

impl Entity {
    pub fn setup_equipment(&mut self) {
        self.is_equipped = is_equipped(&self.species, self.player_index);
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

    pub fn play_equipment_usage_animation(&mut self) {
        self.sprite.frame.y = match self.direction {
            Direction::Up => 37,
            Direction::Down => 45,
            Direction::Right => 41,
            Direction::Left => 49,
            Direction::Unknown => 37,
            Direction::Still => 37,
        }
    }
}

pub fn is_equipped(species: &Species, player: usize) -> bool {
    if let Some(selected) = get_value_for_global_key(&equipment_key_for_species(species, player)) {
        selected == species.id
    } else {
        matches!(species.id, SPECIES_KUNAI_LAUNCHER)
    }
}

pub fn available_weapons(player: usize) -> Vec<Species> {
    let mut all_ids: Vec<u32> = vec![SPECIES_KUNAI_LAUNCHER];
    let owned_ids = ALL_SPECIES
        .iter()
        .filter_map(|s| s.associated_weapon)
        .filter(|species_id| has_species_in_inventory(species_id, player));

    all_ids.extend(owned_ids);
    all_ids.iter().map(|species_id| species_by_id(*species_id)).collect()
}

pub fn set_equipped(species: &Species, player: usize) {
    set_value_for_key(&equipment_key_for_species(species, player), species.id)
}

fn equipment_key_for_species(species: &Species, player: usize) -> String {
    match species.entity_type {
        EntityType::Gun => StorageKey::currently_equipped_gun(player),
        EntityType::Sword => StorageKey::currently_equipped_sword(player),
        _ => "".to_owned()
    }    
}