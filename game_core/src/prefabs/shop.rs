use crate::{constants::{HOUSE_INTERIOR_COLUMNS, HOUSE_INTERIOR_ROWS}, entities::{known_species::{SPECIES_NPC_SHOP_CLERK, SPECIES_SEAT_GREEN, SPECIES_TABLE, SPECIES_TELEPORTER}, species::{make_entity_by_species, species_by_id, Species}}, features::{destination::Destination, entity::Entity}, maps::{biome_tiles::Biome, constructions_tiles::Construction}, utils::{ids::get_next_id, rect::IntRect}, worlds::{world::World, world_type::WorldType}};

pub fn new_shop(species: &Species, source_world_id: u32, x: i32, y: i32) -> Vec<Entity> {
    let mut building = species.make_entity();
    building.frame.x = x;
    building.frame.y = y;

    let first_floor_id = get_next_id();
    let mut door = make_entity_by_species(SPECIES_TELEPORTER);
    door.destination = Some(Destination::nearest(first_floor_id));
    door.frame.x = x + (building.frame.w as f32 / 2.0).ceil() as i32;
    door.frame.y = y + 3;

    let mut door_back1 = make_entity_by_species(SPECIES_TELEPORTER);
    door_back1.destination = Some(Destination::nearest(source_world_id));
    door_back1.frame.x = (HOUSE_INTERIOR_COLUMNS as f32 / 2.0).ceil() as i32;
    door_back1.frame.y = (HOUSE_INTERIOR_ROWS + 2) as i32;

    let mut door_back2 = make_entity_by_species(SPECIES_TELEPORTER);
    door_back2.destination = Some(Destination::nearest(source_world_id));
    door_back2.frame.x = door_back1.frame.x + 1;
    door_back2.frame.y = door_back1.frame.y;

    let mut first_floor = World::load_or_create(first_floor_id);
    first_floor.bounds = IntRect::from_origin(30, 10);
    first_floor.world_type = WorldType::HouseInterior;

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

    first_floor.constructions_tiles.update_tile(3, 5, Construction::Counter);
    first_floor.constructions_tiles.update_tile(2, 5, Construction::Counter);
    first_floor.constructions_tiles.update_tile(3, 6, Construction::Counter);
    first_floor.constructions_tiles.update_tile(3, 7, Construction::Counter);
    first_floor.constructions_tiles.update_tile(3, 8, Construction::Counter);
    first_floor.constructions_tiles.update_tile(2, 8, Construction::Counter);

    first_floor.constructions_tiles.update_tile(1, 1, Construction::Library);
    first_floor.constructions_tiles.update_tile(1, 2, Construction::Library);
    first_floor.constructions_tiles.update_tile(1, 3, Construction::Library);
    first_floor.constructions_tiles.update_tile(1, 4, Construction::Library);    
    first_floor.constructions_tiles.update_tile(2, 1, Construction::Library);
    first_floor.constructions_tiles.update_tile(2, 2, Construction::Library);
    first_floor.constructions_tiles.update_tile(2, 3, Construction::Library);
    first_floor.constructions_tiles.update_tile(2, 4, Construction::Library);

    first_floor.constructions_tiles.update_tile(1, 9, Construction::Library);
    first_floor.constructions_tiles.update_tile(1, 10, Construction::Library);
    first_floor.constructions_tiles.update_tile(2, 9, Construction::Library);
    first_floor.constructions_tiles.update_tile(2, 10, Construction::Library);

    let mut clerk = species_by_id(SPECIES_NPC_SHOP_CLERK).make_entity();
    clerk.frame.x = 6;
    clerk.frame.y = 1;
    clerk.dialogues = vec![];

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
    first_floor.add_entity(table);
    first_floor.add_entity(seat1);
    first_floor.add_entity(seat2);
    first_floor.add_entity(seat3);
    first_floor.add_entity(seat4);
    first_floor.add_entity(clerk);
    first_floor.save();

    vec![building, door]   
}