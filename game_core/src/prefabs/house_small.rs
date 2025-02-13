use crate::{constants::{HOUSE_INTERIOR_COLUMNS, HOUSE_INTERIOR_ROWS}, entities::{known_species::{SPECIES_SEAT_GREEN, SPECIES_TABLE, SPECIES_TELEPORTER}, species::{make_entity_by_species, Species}}, features::{destination::Destination, entity::Entity}, maps::{biomes::Biome, constructions::Construction}, utils::{ids::get_next_id, rect::FRect}, worlds::{world::World, world_type::WorldType}};

pub fn new_small_house(species: &Species, source_world_id: u32, x: f32, y: f32) -> Vec<Entity> {
    let mut building = species.make_entity();
    building.frame.x = x;
    building.frame.y = y;

    let first_floor_id = get_next_id();
    let mut door = make_entity_by_species(SPECIES_TELEPORTER);
    door.destination = Some(Destination::nearest(first_floor_id));
    door.frame.x = x + (building.frame.w as f32 / 2.0).ceil();
    door.frame.y = y + 2.0;

    let mut door_back1 = make_entity_by_species(SPECIES_TELEPORTER);
    door_back1.destination = Some(Destination::nearest(source_world_id));
    door_back1.frame.x = (HOUSE_INTERIOR_COLUMNS as f32 / 2.0).ceil();
    door_back1.frame.y = HOUSE_INTERIOR_ROWS as f32 + 2.0;

    let mut door_back2 = make_entity_by_species(SPECIES_TELEPORTER);
    door_back2.destination = Some(Destination::nearest(source_world_id));
    door_back2.frame.x = door_back1.frame.x + 1.0;
    door_back2.frame.y = door_back1.frame.y;

    let mut first_floor = World::load_or_create(first_floor_id);
    first_floor.world_type = WorldType::HouseInterior;
    first_floor.bounds = FRect::from_origin(30.0, 10.0);

    for row in 0..HOUSE_INTERIOR_ROWS {
        for col in 0..HOUSE_INTERIOR_COLUMNS {
            first_floor.biome_tiles.update_tile(row + 2, col + 1, Biome::DarkWood);
        }
    }
    for row in [0, 1, HOUSE_INTERIOR_ROWS + 2] {
        for col in 0..(HOUSE_INTERIOR_COLUMNS + 1) {
            if row != HOUSE_INTERIOR_ROWS + 2 || (col != door_back1.frame.x as usize && col != door_back2.frame.x as usize) {
                first_floor.construction_tiles.update_tile(row, col, Construction::LightWall);
            }
        }
    }
    for row in 0..(HOUSE_INTERIOR_ROWS + 3) {
        first_floor.construction_tiles.update_tile(row, 0, Construction::LightWall);
    }

    let mut table = make_entity_by_species(SPECIES_TABLE);
    table.frame.x = 1.0;
    table.frame.y = 4.0;

    let mut seat1 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat1.frame.x = 1.0;
    seat1.frame.y = 4.0;

    let mut seat2 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat2.frame.x = 2.0;
    seat2.frame.y = 4.0;

    let mut seat3 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat3.frame.x = 1.0;
    seat3.frame.y = 6.0;

    let mut seat4 = make_entity_by_species(SPECIES_SEAT_GREEN);
    seat4.frame.x = 2.0;
    seat4.frame.y = 6.0;

    first_floor.add_entity(door_back1);
    first_floor.add_entity(door_back2);
    first_floor.add_entity(table);
    first_floor.add_entity(seat1);
    first_floor.add_entity(seat2);
    first_floor.add_entity(seat3);
    first_floor.add_entity(seat4);
    first_floor.save();

    vec![building, door]   
}