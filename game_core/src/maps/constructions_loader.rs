use crate::{constants::SPRITE_SHEET_CONSTRUCTION_TILES, game_engine::world::World};

use super::{constructions_tiles::ConstructionTile, tiles::TileSet};

impl World {    
    pub fn load_construction_tiles(&mut self, tiles: TileSet<ConstructionTile>) {
        let nothing = ConstructionTile::from_data('0');
        let tiles = if tiles.tiles.is_empty() {
            TileSet::<ConstructionTile>::with_tiles(
                SPRITE_SHEET_CONSTRUCTION_TILES,
                vec![vec![nothing; self.bounds.w as usize]; self.bounds.y as usize]
            )
        } else {
            tiles
        };
        self.constructions_tiles = tiles;     
    }
}