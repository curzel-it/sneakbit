
use crate::{constants::{BIOME_NUMBER_OF_FRAMES, SPRITE_SHEET_BLANK, TILE_VARIATIONS_FPS}, utils::{rect::IntRect, timed_content_provider::TimedContentProvider}};

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