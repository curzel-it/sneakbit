use crate::{entities::species::Species, game_engine::entity::Entity, prefabs::{house_single_floor::new_house_single_floor, house_small::new_small_house, house_two_floors::new_house_two_floors, shop::new_shop}};

pub fn new_building(source_world_id: u32, x: i32, y: i32, species: &Species) -> Vec<Entity> {
    if is_small_house(species.id) {
        return new_small_house(species, source_world_id, x, y);
    }
    if is_house(species.id) {
        return new_house_single_floor(species, source_world_id, x, y);
    }
    if is_two_floors_house(species.id) {
        return new_house_two_floors(species, source_world_id, x, y);
    }
    if is_large_two_floors_house(species.id) {
        return new_house_two_floors(species, source_world_id, x, y);
    }
    if is_shop(species.id) {
        return new_shop(species, source_world_id, x, y);
    }

    let mut building = species.make_entity();
    building.frame.x = x;
    building.frame.y = y;
    vec![building]
}

fn is_small_house(species_id: u32) -> bool {
    matches!(species_id, 1033)
}

fn is_house(species_id: u32) -> bool {
    matches!(species_id, 1002 | 1003 | 1004 | 1084 | 1086 | 1087)
}

fn is_two_floors_house(species_id: u32) -> bool {
    matches!(species_id, 1005 | 1006 | 1007 | 1085)
}

fn is_large_two_floors_house(species_id: u32) -> bool {
    matches!(species_id, 1010 | 1088)
}

fn is_shop(species_id: u32) -> bool {
    matches!(species_id, 1070 | 1071 | 1072)
}
