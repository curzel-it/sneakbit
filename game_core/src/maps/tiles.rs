
use crate::{constants::{BIOME_NUMBER_OF_FRAMES, SPRITE_SHEET_BLANK, TILE_VARIATIONS_FPS}, game_engine::world::World, utils::{rect::IntRect, timed_content_provider::TimedContentProvider}};

use super::{biome_tiles::BiomeTile, constructions_tiles::ConstructionTile};

pub trait SpriteTile {
    fn texture_source_rect(&self, variant: i32) -> IntRect;
}

#[derive(Default, Clone)]
pub struct TileSet<T> {
    pub tiles: Vec<Vec<T>>,
    pub sheet_id: u32,
    sprite_counter: TimedContentProvider<i32>,
}

impl<T> TileSet<T> {
    pub fn empty() -> Self {
        Self::with_tiles(SPRITE_SHEET_BLANK, vec![])
    }

    pub fn with_tiles(sheet_id: u32, tiles: Vec<Vec<T>>) -> Self {
        Self { 
            tiles,
            sheet_id,
            sprite_counter: Self::content_provider()
        }
    }

    pub fn content_provider() -> TimedContentProvider<i32> {
        TimedContentProvider::new(Vec::from_iter(0..BIOME_NUMBER_OF_FRAMES), TILE_VARIATIONS_FPS)
    }

    pub fn update(&mut self, time_since_last_update: f32) {
        self.sprite_counter.update(time_since_last_update);
    }

    pub fn current_variant(&self) -> i32 {
        *self.sprite_counter.current_frame() % BIOME_NUMBER_OF_FRAMES
    }
}

pub struct RevisedTiles {
    pub current_revision: u32,
    pub biome_tiles: Vec<Vec<BiomeTile>>,
    pub construction_tiles: Vec<Vec<ConstructionTile>>
}

pub fn tiles_with_revision(world_id: u32) -> RevisedTiles {
    if let Some(world) = World::load(world_id) {
        RevisedTiles {
            current_revision: world.revision,
            biome_tiles: world.biome_tiles.tiles,
            construction_tiles: world.constructions_tiles.tiles
        }
    } else {
        RevisedTiles { 
            current_revision: 0, 
            biome_tiles: vec![], 
            construction_tiles: vec![] 
        }
    }
}