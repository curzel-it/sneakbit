use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer, de::Deserializer};

use crate::utils::rect::IntRect;

use super::tiles::{SpriteTile, TileSet};

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
#[derive(Default)]
#[repr(u32)]
pub enum Construction {
    #[default]
    Nothing = 0,
    WoodenFence,
    MetalFence,
    DarkRock,
    LightWall,
    Counter,
    Library,
    TallGrass,
    Forest,
    Bamboo,
    Box,
    Rail,
    StoneWall,
    IndicatorArrow,
    Bridge,
    Broadleaf,
    StoneBox,
    SpoiledTree,
    WineTree
}

#[derive(Debug, Default, Clone, Copy)]
#[repr(C)]
pub struct ConstructionTile {
    pub tile_type: Construction,
    pub tile_up_type: Construction,
    pub tile_right_type: Construction,
    pub tile_down_type: Construction,
    pub tile_left_type: Construction,
    pub texture_source_rect: IntRect,
}

impl SpriteTile for ConstructionTile {
    fn texture_source_rect(&self, _: i32) -> IntRect {
        self.texture_source_rect
    }
}

impl ConstructionTile {
    pub fn is_obstacle(&self) -> bool {
        match self.tile_type {
            Construction::Nothing => false,
            Construction::TallGrass => false,
            Construction::Box => false,
            Construction::Rail => false,
            Construction::Bridge => false,
            _ => true
        }
    }

    pub fn setup_neighbors(&mut self, up: Construction, right: Construction, bottom: Construction, left: Construction) {
        self.tile_up_type = up;
        self.tile_right_type = right;
        self.tile_down_type = bottom;
        self.tile_left_type = left;        
        self.setup_textures();    
    }

    fn setup_textures(&mut self) {
        let same_up = self.tile_up_type == self.tile_type;
        let same_right = self.tile_right_type == self.tile_type;
        let same_down = self.tile_down_type == self.tile_type;
        let same_left = self.tile_left_type == self.tile_type;

        let x = self.tile_type.texture_offset_x();
        let y = match (same_up, same_right, same_down, same_left) {
            (false, true, false, true) => 0,
            (false, false, false, false) => 1,
            (false, false, false, true) => 2,
            (false, true, false, false) => 3,
            (true, false, true, false) => 4,
            (true, false, false, false) => 5,
            (false, false, true, false) => 6,
            (true, true, false, false) => 7,
            (true, false, false, true) => 8,
            (false, true, true, false) => 9,
            (false, false, true, true) => 10,
            (true, true, true, false) => 11,
            (true, false, true, true) => 12,
            (true, true, false, true) => 13,
            (false, true, true, true) => 14,
            (true, true, true, true) => 15,
        };
        self.texture_source_rect.x = x;
        self.texture_source_rect.y = y;
    }
}

impl Construction {
    fn texture_offset_x(&self) -> i32 {
        match self {
            Construction::Nothing => 0,
            Construction::WoodenFence => 1,
            Construction::DarkRock => 3,
            Construction::LightWall => 4,
            Construction::Counter => 5,
            Construction::Library => 6,
            Construction::TallGrass => 7,
            Construction::Forest => 8,
            Construction::Bamboo => 9,
            Construction::Box => 10,
            Construction::Rail => 11,
            Construction::StoneWall => 12,
            Construction::IndicatorArrow => 13,
            Construction::Bridge => 14,
            Construction::Broadleaf => 15,
            Construction::MetalFence => 16,
            Construction::StoneBox => 17,
            Construction::SpoiledTree => 18,
            Construction::WineTree => 19
        }
    }
}

impl TileSet<ConstructionTile> {
    pub fn update_tile(&mut self, row: usize, col: usize, new_biome: Construction) {
        self.tiles[row][col].tile_type = new_biome;
        self.tiles[row][col].setup_textures();

        if row > 0 {
            self.tiles[row-1][col].tile_down_type = new_biome;
            self.tiles[row-1][col].setup_textures();
        }
        if row < self.tiles.len() - 1 {
            self.tiles[row+1][col].tile_up_type = new_biome;
            self.tiles[row+1][col].setup_textures();
        }
        if col > 0 {
            self.tiles[row][col-1].tile_right_type = new_biome;
            self.tiles[row][col-1].setup_textures();
        }
        if col < self.tiles[0].len() - 1 {
            self.tiles[row][col+1].tile_left_type = new_biome;
            self.tiles[row][col+1].setup_textures();
        }
    }
}

impl Construction {
    fn from_char(c: char) -> Self {
        match c {
            '0' => Construction::Nothing,
            '1' => Construction::WoodenFence,
            '3' => Construction::DarkRock,
            '4' => Construction::LightWall,
            '5' => Construction::Counter,
            '6' => Construction::Library,
            '7' => Construction::TallGrass,
            '8' => Construction::Forest,
            '9' => Construction::Bamboo,
            'A' => Construction::Box,
            'B' => Construction::Rail,
            'C' => Construction::StoneWall,
            'D' => Construction::IndicatorArrow,
            'E' => Construction::Bridge,
            'F' => Construction::Broadleaf,
            'G' => Construction::MetalFence,
            'H' => Construction::StoneBox,
            'J' => Construction::SpoiledTree,
            'K' => Construction::WineTree,
            _ => Construction::Nothing,
        }
    }

    pub fn to_char(self) -> char {
        match self {
            Construction::Nothing => '0',
            Construction::WoodenFence => '1',
            Construction::DarkRock => '3',
            Construction::LightWall => '4',
            Construction::Counter => '5',
            Construction::Library => '6',
            Construction::TallGrass => '7',
            Construction::Forest => '8',
            Construction::Bamboo => '9',
            Construction::Box => 'A',
            Construction::Rail => 'B',
            Construction::StoneWall => 'C',
            Construction::IndicatorArrow => 'D',
            Construction::Bridge => 'E',
            Construction::Broadleaf => 'F',
            Construction::MetalFence => 'G',
            Construction::StoneBox => 'H',
            Construction::SpoiledTree => 'J',
            Construction::WineTree => 'K'
        }
    }
}

impl ConstructionTile {
    pub fn from_data(data: char) -> Self {
        let mut tile = Self { 
            tile_type: Construction::from_char(data), 
            tile_up_type: Construction::Nothing,
            tile_right_type: Construction::Nothing, 
            tile_down_type: Construction::Nothing, 
            tile_left_type: Construction::Nothing, 
            texture_source_rect: IntRect::square_from_origin(1) 
        };
        tile.setup_textures();
        tile
    }
}

impl Serialize for TileSet<ConstructionTile> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut state = serializer.serialize_struct("TileSet", 2)?;
        let serialized_tiles: Vec<String> = self.tiles.iter().map(|row| {
            row.iter().map(|tile| {
                tile.tile_type.to_char()
            }).collect()
        }).collect();

        state.serialize_field("tiles", &serialized_tiles)?;
        state.serialize_field("sheet_id", &self.sheet_id)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for TileSet<ConstructionTile> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        #[derive(Deserialize)]
        struct TileSetData {
            tiles: Vec<String>,
            sheet_id: u32,
        }

        let data = TileSetData::deserialize(deserializer)?;

        let mut tiles: Vec<Vec<ConstructionTile>> = data.tiles.into_iter().map(|tile_row| {
            tile_row.chars().map(|tile_char| {
                ConstructionTile::from_data(tile_char)
            }).collect()
        }).collect();

        let rows = tiles.len();
        let columns = if rows > 0 { tiles[0].len() } else { 0 };

        for row in 0..rows {
            for col in 0..columns {
                let up = if row > 0 { tiles[row-1][col].tile_type } else { Construction::Nothing };
                let right = if col < columns - 1 { tiles[row][col+1].tile_type } else { Construction::Nothing };
                let down = if row < rows - 1 { tiles[row+1][col].tile_type } else { Construction::Nothing };
                let left = if col > 0 { tiles[row][col-1].tile_type } else { Construction::Nothing };

                tiles[row][col].setup_neighbors(up, right, down, left)
            }
        }

        Ok(TileSet::with_tiles(data.sheet_id, tiles))
    }
}

impl Construction {
    pub fn stops_bullets(&self) -> bool {
        match self {
            Construction::Nothing => false,
            Construction::WoodenFence => false,
            Construction::MetalFence => true,
            Construction::DarkRock => true,
            Construction::LightWall => true,
            Construction::Counter => false,
            Construction::Library => true,
            Construction::TallGrass => false,
            Construction::Forest => true,
            Construction::Bamboo => false,
            Construction::Box => true,
            Construction::Rail => false,
            Construction::StoneWall => true,
            Construction::IndicatorArrow => false,
            Construction::Bridge => false,
            Construction::Broadleaf => true,
            Construction::StoneBox => true,
            Construction::SpoiledTree => false,
            Construction::WineTree => false
        }
    }
}