use std::{fs::File, io::{BufReader, Write}};

use serde::{ser::SerializeStruct, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Error;
use crate::{config::config, constants::{SPRITE_SHEET_BIOME_TILES, SPRITE_SHEET_CONSTRUCTION_TILES, WORLD_SIZE_COLUMNS, WORLD_SIZE_ROWS}, entities::known_species::SPECIES_HERO, game_engine::{entity::Entity, world::World}, maps::{biome_tiles::{Biome, BiomeTile}, constructions_tiles::ConstructionTile, tiles::TileSet}};

impl World {
    pub fn load(id: u32) -> Option<Self> {
        let mut path = config().levels_path.clone();
        path.push(format!("{}.json", id));

        if let Ok(file) = File::open(path) {
            let reader = BufReader::new(file);        
            let result: Result<Self, Error> = serde_json::from_reader(reader);

            if let Ok(world) = result {
                println!("Game saved successfully!");
                return Some(world)
            } else {
                println!("Failed to parse game {}.json: {:#?}", id, result.err());
            } 
        } else {
            println!("Failed to load game file at {}.json", id);
        }
        None
    }

    pub fn load_or_create(id: u32) -> Self {
        Self::load(id).unwrap_or_else(|| {
            let new = Self::new_with_default_biomes(id);
            new.save();
            new
        })
    }

    pub fn save(&self) {
        let mut path = config().levels_path.clone();
        path.push(format!("{}.json", self.id));

        if let Ok(serialized_world) = serde_json::to_string_pretty(self) {
            if let Ok(mut file) = File::create(path.clone()) {
                if let Err(e) = file.write_all(serialized_world.as_bytes()) {
                    eprintln!("Failed to write save file: {}", e);
                } else {
                    println!("Game saved successfully to {}.json", self.id);
                }
            } else {
                eprintln!("Failed to create save file");
            }
        } else {
            eprintln!("Failed to serialize game world");
        }
    }

    fn new_with_default_biomes(id: u32) -> Self {
        let mut world = World::new(id);

        let biome_tile_set = TileSet::<BiomeTile>::with_tiles(
            SPRITE_SHEET_BIOME_TILES, 
            (0..WORLD_SIZE_ROWS).map(|_| {
                (0..WORLD_SIZE_COLUMNS).map(|_| {
                    let mut tile = BiomeTile::from_data('0');
                    tile.setup_neighbors(tile.tile_type, tile.tile_type, tile.tile_type, tile.tile_type);
                    tile
                }).collect()
            }).collect()
        );
        world.load_biome_tiles(biome_tile_set);

        let construction_tile_set = TileSet::<ConstructionTile>::with_tiles(
            SPRITE_SHEET_CONSTRUCTION_TILES, 
            (0..WORLD_SIZE_ROWS).map(|_| {
                (0..WORLD_SIZE_COLUMNS).map(|_| {
                    let mut tile = ConstructionTile::from_data('0');
                    tile.setup_neighbors(tile.tile_type, tile.tile_type, tile.tile_type, tile.tile_type);
                    tile
                }).collect()
            }).collect()
        );
        world.load_construction_tiles(construction_tile_set);

        world
    }    
}

#[derive(Serialize, Deserialize)]
struct WorldData {
    id: u32,

    #[serde(default)]
    revision: u32,

    #[serde(default)]
    biome_tiles: TileSet<BiomeTile>,

    #[serde(default)]
    constructions_tiles: TileSet<ConstructionTile>,

    #[serde(default)]
    entities: Vec<Entity>,

    #[serde(default)]
    creep_spawn_enabled: bool,

    #[serde(default)]
    creep_spawn_interval: f32,

    #[serde(default)]
    default_biome: Biome,
}

impl Serialize for World {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {       
        let borrowed_entities = self.entities.borrow();
        let entities: Vec<&Entity> = borrowed_entities.iter()
            .filter(|e| e.species_id != SPECIES_HERO && !e.is_dying)
            .collect();

        let mut state = serializer.serialize_struct("World", 4)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("revision", &self.revision)?;
        state.serialize_field("biome_tiles", &self.biome_tiles)?;
        state.serialize_field("constructions_tiles", &self.constructions_tiles)?;
        state.serialize_field("entities", &entities)?;
        state.serialize_field("creep_spawn_enabled", &self.creep_spawn_enabled)?;
        state.serialize_field("creep_spawn_interval", &self.creep_spawn_interval)?;
        state.serialize_field("default_biome", &self.default_biome)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for World {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        let data = WorldData::deserialize(deserializer)?;

        let mut world = World::new(data.id);        
        world.revision = data.revision;
        world.default_biome = data.default_biome;
        world.creep_spawn_enabled = data.creep_spawn_enabled;
        world.creep_spawn_interval = data.creep_spawn_interval;
        data.entities.into_iter().for_each(|e| _ = world.add_entity(e));        
        world.load_biome_tiles(data.biome_tiles);
        world.load_construction_tiles(data.constructions_tiles);
        Ok(world)
    }
}