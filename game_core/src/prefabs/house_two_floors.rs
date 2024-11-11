use crate::{constants::{HOUSE_INTERIOR_COLUMNS, HOUSE_INTERIOR_ROWS}, entities::{known_species::{SPECIES_SEAT_GREEN, SPECIES_STAIRS_DOWN, SPECIES_STAIRS_UP, SPECIES_TABLE, SPECIES_TELEPORTER}, species::{make_entity_by_species, Species}}, features::destination::Destination, game_engine::{entity::Entity, world::World}, maps::{biome_tiles::Biome, constructions_tiles::Construction}, utils::{ids::get_next_id, rect::IntRect}};

pub fn new_house_two_floors(species: &Species, source_world_id: u32, x: i32, y: i32) -> Vec<Entity> {
    let mut building = species.make_entity();
    building.frame.x = x;
    building.frame.y = y;

    let first_floor_id = get_next_id();
    let second_floor_id = get_next_id();

    let mut door = make_entity_by_species(SPECIES_TELEPORTER);
    door.destination = Some(Destination::nearest(first_floor_id));
    door.frame.x = x + (building.frame.w as f32 / 2.0).ceil() as i32;
    door.frame.y = y + 4;

    let mut door_back1 = make_entity_by_species(SPECIES_TELEPORTER);
    door_back1.destination = Some(Destination::nearest(source_world_id));
    door_back1.frame.x = (HOUSE_INTERIOR_COLUMNS as f32 / 2.0).ceil() as i32;
    door_back1.frame.y = (HOUSE_INTERIOR_ROWS + 2) as i32;

    let mut door_back2 = make_entity_by_species(SPECIES_TELEPORTER);
    door_back2.destination = Some(Destination::nearest(source_world_id));
    door_back2.frame = door_back1.frame.offset_x(1);

    let mut stairs_up = make_entity_by_species(SPECIES_STAIRS_UP);
    stairs_up.frame.x = HOUSE_INTERIOR_COLUMNS as i32 - 2;
    stairs_up.frame.y = 0;

    let mut stairs_up_door = make_entity_by_species(SPECIES_TELEPORTER);
    stairs_up_door.destination = Some(Destination::nearest(second_floor_id));
    stairs_up_door.frame.x = stairs_up.frame.x;
    stairs_up_door.frame.y = stairs_up.frame.y + 1;

    let mut first_floor = World::load_or_create(first_floor_id);
    first_floor.is_interior = true;
    first_floor.bounds = IntRect::from_origin(30, 10);

    for row in 0..HOUSE_INTERIOR_ROWS {
        for col in 0..HOUSE_INTERIOR_COLUMNS {
            first_floor.biome_tiles.update_tile(row + 2, col + 1, Biome::DarkWood);
        }
    }
    for row in [0, 1, HOUSE_INTERIOR_ROWS + 2] {
        for col in 0..(HOUSE_INTERIOR_COLUMNS + 1) {
            if row != HOUSE_INTERIOR_ROWS + 2 || (col != door_back1.frame.x as usize && col != door_back2.frame.x as usize) {
                first_floor.constructions_tiles.update_tile(row, col, Construction::LightWall);
            }
        }
    }
    for row in 0..(HOUSE_INTERIOR_ROWS + 3) {
        first_floor.constructions_tiles.update_tile(row, 0, Construction::LightWall);
    }

    let mut table = make_entity_by_species(SPECIES_TABLE);
    table.frame.x = 1;
    table.frame.y = 4;

    let mut seat1 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat1.frame.x = 1;
    seat1.frame.y = 4;

    let mut seat2 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat2.frame.x = 2;
    seat2.frame.y = 4;

    let mut seat3 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat3.frame.x = 1;
    seat3.frame.y = 6;

    let mut seat4 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat4.frame.x = 2;
    seat4.frame.y = 6;

    first_floor.add_entity(door_back1);
    first_floor.add_entity(door_back2);
    first_floor.add_entity(stairs_up);
    first_floor.add_entity(stairs_up_door);
    first_floor.add_entity(table);
    first_floor.add_entity(seat1);
    first_floor.add_entity(seat2);
    first_floor.add_entity(seat3);
    first_floor.add_entity(seat4);
    first_floor.save();    

    let mut stairs_down = make_entity_by_species(SPECIES_STAIRS_DOWN);
    stairs_down.frame.x = HOUSE_INTERIOR_COLUMNS as i32 - 2;
    stairs_down.frame.y = 1;

    let mut stairs_down_door = make_entity_by_species(SPECIES_TELEPORTER);
    stairs_down_door.destination = Some(Destination::nearest(first_floor_id));
    stairs_down_door.frame.x = stairs_down.frame.x;
    stairs_down_door.frame.y = stairs_down.frame.y + 1;

    let mut second_floor = World::load_or_create(second_floor_id);
    second_floor.is_interior = true;
    second_floor.bounds = IntRect::from_origin(30, 10);

    for row in 0..HOUSE_INTERIOR_ROWS {
        for col in 0..HOUSE_INTERIOR_COLUMNS {
            second_floor.biome_tiles.update_tile(row + 2, col + 1, Biome::DarkWood);
        }
    }
    for row in [0, 1, HOUSE_INTERIOR_ROWS + 2] {
        for col in 0..(HOUSE_INTERIOR_COLUMNS + 1) {
            second_floor.constructions_tiles.update_tile(row, col, Construction::LightWall);
        }
    }
    for row in 0..(HOUSE_INTERIOR_ROWS + 3) {
        second_floor.constructions_tiles.update_tile(row, 0, Construction::LightWall);
    }

    second_floor.add_entity(stairs_down);
    second_floor.add_entity(stairs_down_door);
    second_floor.save();    

    vec![building, door]   
}