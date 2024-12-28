use std::{fs::File, io::{BufReader, Write}};

use serde::{ser::SerializeStruct, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Error;
use crate::{config::config, constants::{SPRITE_SHEET_BIOME_TILES, SPRITE_SHEET_CONSTRUCTION_TILES}, entities::{known_species::SPECIES_HERO, species::EntityType}, features::{cutscenes::CutScene, light_conditions::LightConditions}, features::entity::Entity, maps::{biome_tiles::{Biome, BiomeTile}, construction_tiles::ConstructionTile, tiles::TileSet}, utils::rect::FRect};

use super::{world::World, world_type::WorldType};

impl World {
    pub fn load(id: u32) -> Option<Self> {
        let mut path = config().levels_path.clone();
        path.push(format!("{}.json", id));

        if let Ok(file) = File::open(path) {
            let reader = BufReader::new(file);        
            let result: Result<Self, Error> = serde_json::from_reader(reader);

            if let Ok(world) = result {
                println!("World loaded successfully!");
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
            (0..world.bounds.h as usize).map(|_| {
                (0..world.bounds.w as usize).map(|_| {
                    let mut tile = BiomeTile::from_data('0');
                    tile.setup_neighbors(tile.tile_type, tile.tile_type, tile.tile_type, tile.tile_type);
                    tile
                }).collect()
            }).collect()
        );
        world.load_biome_tiles(biome_tile_set);

        let construction_tile_set = TileSet::<ConstructionTile>::with_tiles(
            SPRITE_SHEET_CONSTRUCTION_TILES, 
            (0..world.bounds.h as usize).map(|_| {
                (0..world.bounds.w as usize).map(|_| {
                    let mut tile = ConstructionTile::from_data('0');
                    tile.setup_neighbors(tile.tile_type, tile.tile_type, tile.tile_type, tile.tile_type);
                    tile
                }).collect()
            }).collect()
        );
        world.load_construction_tiles(construction_tile_set);

        world
    }
    
    fn load_biome_tiles(&mut self, tiles: TileSet<BiomeTile>) {
        let mut grass = BiomeTile::from_data('1');
        grass.setup_neighbors(Biome::Grass, Biome::Grass, Biome::Grass, Biome::Grass);

        let tiles = if tiles.tiles.is_empty() {
            TileSet::<BiomeTile>::with_tiles(
                SPRITE_SHEET_BIOME_TILES,
                vec![vec![grass; self.bounds.w as usize]; self.bounds.h as usize]
            )
        } else {
            tiles
        };
        self.bounds = FRect::new(0.0, 0.0, tiles.tiles[0].len() as f32, tiles.tiles.len() as f32);
        self.biome_tiles = tiles;            
    }

    fn load_construction_tiles(&mut self, tiles: TileSet<ConstructionTile>) {
        let nothing = ConstructionTile::from_data('0');
        let tiles = if tiles.tiles.is_empty() {
            TileSet::<ConstructionTile>::with_tiles(
                SPRITE_SHEET_CONSTRUCTION_TILES,
                vec![vec![nothing; self.bounds.w as usize]; self.bounds.y as usize]
            )
        } else {
            tiles
        };
        self.construction_tiles = tiles;     
    }
}

#[derive(Serialize, Deserialize)]
struct WorldData {
    id: u32,
    world_type: WorldType,

    #[serde(default)]
    revision: u32,

    #[serde(default)]
    biome_tiles: TileSet<BiomeTile>,

    #[serde(default)]
    construction_tiles: TileSet<ConstructionTile>,

    #[serde(default)]
    entities: Vec<Entity>,

    #[serde(default)]
    is_interior: bool,

    #[serde(default)]
    light_conditions: LightConditions,

    #[serde(default)]
    ephemeral_state: bool,

    #[serde(default)]
    soundtrack: Option<String>,

    #[serde(default)]
    cutscenes: Vec<CutScene>,
}

impl Serialize for World {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {       
        let borrowed_entities = self.entities.borrow();
        let entities: Vec<&Entity> = borrowed_entities.iter()
            .filter(|e| e.species_id != SPECIES_HERO && !e.is_dying && !matches!(e.entity_type, EntityType::Trail) && !e.is_equipment())
            .collect();

        let mut state = serializer.serialize_struct("World", 4)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("revision", &self.revision)?;
        state.serialize_field("ephemeral_state", &self.ephemeral_state)?;
        state.serialize_field("biome_tiles", &self.biome_tiles)?;
        state.serialize_field("construction_tiles", &self.construction_tiles)?;
        state.serialize_field("entities", &entities)?;
        state.serialize_field("light_conditions", &self.light_conditions)?;
        state.serialize_field("cutscenes", &self.cutscenes)?;
        state.serialize_field("soundtrack", &self.soundtrack)?;
        state.serialize_field("world_type", &self.world_type)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for World {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        let data = WorldData::deserialize(deserializer)?;

        let mut world = World::new(data.id);        
        world.revision = data.revision;
        world.ephemeral_state = data.ephemeral_state;
        world.world_type = data.world_type;
        world.light_conditions = data.light_conditions;
        world.cutscenes = data.cutscenes;
        world.soundtrack = data.soundtrack;
        data.entities.into_iter().for_each(|e| _ = world.add_entity(e));        
        world.load_biome_tiles(data.biome_tiles);
        world.load_construction_tiles(data.construction_tiles);
        Ok(world)
    }
}