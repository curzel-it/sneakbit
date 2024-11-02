use crate::{entities::{known_species::{SPECIES_HOUSE_1, SPECIES_HOUSE_2, SPECIES_HOUSE_3, SPECIES_HOUSE_SHOP_1, SPECIES_HOUSE_SHOP_2, SPECIES_HOUSE_SHOP_3, SPECIES_HOUSE_SMALL_1, SPECIES_HOUSE_TWO_FLOORS_1, SPECIES_HOUSE_TWO_FLOORS_2, SPECIES_HOUSE_TWO_FLOORS_3, SPECIES_VILLA_2}, species::Species}, game_engine::entity::Entity};

use super::{house_single_floor::new_house_single_floor, house_small::new_small_house, house_two_floors::new_house_two_floors, shop::new_shop};

pub fn new_building(source_world_id: u32, x: i32, y: i32, species: &Species) -> Vec<Entity> {
    match species.id {
        SPECIES_HOUSE_1 => new_house_single_floor(species, source_world_id, x, y),
        SPECIES_HOUSE_SMALL_1 => new_small_house(species, source_world_id, x, y),
        SPECIES_HOUSE_2 => new_house_single_floor(species, source_world_id, x, y),
        SPECIES_HOUSE_3 => new_house_single_floor(species, source_world_id, x, y),
        SPECIES_HOUSE_TWO_FLOORS_1 => new_house_two_floors(species, source_world_id, x, y),
        SPECIES_HOUSE_TWO_FLOORS_2 => new_house_two_floors(species, source_world_id, x, y),
        SPECIES_HOUSE_TWO_FLOORS_3 => new_house_two_floors(species, source_world_id, x, y),
        SPECIES_HOUSE_SHOP_1 => new_shop(species, source_world_id, x, y),
        SPECIES_HOUSE_SHOP_2 => new_shop(species, source_world_id, x, y),
        SPECIES_HOUSE_SHOP_3 => new_shop(species, source_world_id, x, y),
        SPECIES_VILLA_2 => new_house_two_floors(species, source_world_id, x, y),
        _ => {
            let mut building = species.make_entity();
            building.frame.x = x;
            building.frame.y = y;
            vec![building]
        }
    }
}