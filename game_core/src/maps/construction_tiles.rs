use std::collections::HashMap;

use lazy_static::lazy_static;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer, de::Deserializer};
use crate::utils::rect::FRect;
use super::tiles::{SpriteTile, TileSet};

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
#[derive(Default)]
#[repr(i32)]
pub enum Construction {
    WoodenFence = 1,
    #[default]
    Nothing = 2,
    DarkRock = 3,
    LightWall = 4,
    Counter = 5,
    Library = 6,
    TallGrass = 7,
    Forest = 8,
    Bamboo = 9,
    Box = 10,
    Rail = 11,
    StoneWall = 12,
    IndicatorArrow = 13,
    Bridge = 14,
    Broadleaf = 15,
    MetalFence = 16,       
    StoneBox = 17,
    SpoiledTree = 18,
    WineTree = 19,
    SolarPanel = 20,
    Pipe = 21,
    BroadleafPurple = 22,
    WoodenWall = 23,
    SnowPile = 24,
    SnowyForest = 25,
    Darkness15 = 26,
    Darkness30 = 27,
    Darkness45 = 28,
    SlopeGreenTopLeft = 29,
    SlopeGreenTopRight = 30,
    SlopeGreenBottomRight = 31,
    SlopeGreenBottomLeft = 32,
    SlopeGreenBottom = 33,
    SlopeGreenTop = 34,
    SlopeGreenLeft = 35,
    SlopeGreenRight = 36,
    SlopeRockTopLeft = 37,
    SlopeRockTopRight = 38,
    SlopeRockBottomRight = 39,
    SlopeRockBottomLeft = 40,
    SlopeRockBottom = 41,
    SlopeRockTop = 42,
    SlopeRockLeft = 43,
    SlopeRockRight = 44,
    SlopeSandTopLeft = 45,
    SlopeSandTopRight = 46,
    SlopeSandBottomRight = 47,
    SlopeSandBottomLeft = 48,
    SlopeSandBottom = 49,
    SlopeSandTop = 50,
    SlopeSandLeft = 51,
    SlopeSandRight = 52,
    SlopeDarkRockTopLeft = 53,
    SlopeDarkRockTopRight = 54,
    SlopeDarkRockBottomRight = 55,
    SlopeDarkRockBottomLeft = 56,
    SlopeDarkRockBottom = 57,
    SlopeDarkRockTop = 58,
    SlopeDarkRockLeft = 59,
    SlopeDarkRockRight = 60,
}

lazy_static! {
    static ref CONSTRUCTION_ENCODINGS: Vec<(char, Construction)> = vec![
        ('0', Construction::Nothing),
        ('1', Construction::WoodenFence),
        ('3', Construction::DarkRock),
        ('4', Construction::LightWall),
        ('5', Construction::Counter),
        ('6', Construction::Library),
        ('7', Construction::TallGrass),
        ('8', Construction::Forest),
        ('9', Construction::Bamboo),
        ('A', Construction::Box),
        ('B', Construction::Rail),
        ('C', Construction::StoneWall),
        ('D', Construction::IndicatorArrow),
        ('E', Construction::Bridge),
        ('F', Construction::Broadleaf),
        ('G', Construction::MetalFence),
        ('H', Construction::StoneBox),
        ('J', Construction::SpoiledTree),
        ('K', Construction::WineTree),
        ('L', Construction::SolarPanel),
        ('M', Construction::Pipe),
        ('N', Construction::BroadleafPurple),
        ('O', Construction::WoodenWall),
        ('P', Construction::SnowPile),
        ('Q', Construction::SnowyForest),
        ('R', Construction::Darkness15),
        ('S', Construction::Darkness30),
        ('T', Construction::Darkness45),
        ('U', Construction::SlopeGreenTopLeft),
        ('V', Construction::SlopeGreenTopRight),
        ('W', Construction::SlopeGreenBottomRight),
        ('X', Construction::SlopeGreenBottomLeft),
        ('Y', Construction::SlopeGreenBottom),
        ('Z', Construction::SlopeGreenTop),
        ('a', Construction::SlopeGreenLeft),
        ('b', Construction::SlopeGreenRight),
        ('c', Construction::SlopeRockTopLeft),
        ('d', Construction::SlopeRockTopRight),
        ('e', Construction::SlopeRockBottomRight),
        ('f', Construction::SlopeRockBottomLeft),
        ('g', Construction::SlopeRockBottom),
        ('h', Construction::SlopeRockTop),
        ('j', Construction::SlopeRockLeft),
        ('k', Construction::SlopeRockRight),
        ('i', Construction::SlopeSandTopLeft),
        ('l', Construction::SlopeSandTopRight),
        ('m', Construction::SlopeSandBottomRight),
        ('n', Construction::SlopeSandBottomLeft),
        ('o', Construction::SlopeSandBottom),
        ('p', Construction::SlopeSandTop),
        ('q', Construction::SlopeSandLeft),
        ('r', Construction::SlopeSandRight),
        ('s', Construction::SlopeDarkRockTopLeft),
        ('t', Construction::SlopeDarkRockTopRight),
        ('u', Construction::SlopeDarkRockBottomRight),
        ('v', Construction::SlopeDarkRockBottomLeft),
        ('w', Construction::SlopeDarkRockBottom),
        ('x', Construction::SlopeDarkRockTop),
        ('y', Construction::SlopeDarkRockLeft),
        ('z', Construction::SlopeDarkRockRight),
    ];

    static ref CHAR_TO_CONSTRUCTION: HashMap<char, Construction> = CONSTRUCTION_ENCODINGS.clone().into_iter().collect();
    static ref CONSTRUCTION_TO_CHAR: HashMap<Construction, char> = CONSTRUCTION_ENCODINGS.clone().into_iter().map(|(char, biome)| (biome, char)).collect();
}

#[derive(Debug, Default, Clone, Copy)]
#[repr(C)]
pub struct ConstructionTile {
    pub tile_type: Construction,
    pub tile_up_type: Construction,
    pub tile_right_type: Construction,
    pub tile_down_type: Construction,
    pub tile_left_type: Construction,
    pub texture_source_rect: FRect,
}

impl SpriteTile for ConstructionTile {
    fn texture_source_rect(&self, _: i32) -> FRect {
        self.texture_source_rect
    }
}

impl ConstructionTile {
    #[allow(clippy::match_like_matches_macro)]
    pub fn is_obstacle(&self) -> bool {
        match self.tile_type {
            Construction::Nothing => false,
            Construction::TallGrass => false,
            Construction::Box => false,
            Construction::Rail => false,
            Construction::Bridge => false,
            Construction::Darkness15 => false,
            Construction::Darkness30 => false,
            Construction::Darkness45 => false,
            _ => true
        }
    }

    pub fn is_bridge(&self) -> bool {
        matches!(self.tile_type, Construction::Bridge)
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
        self.texture_source_rect.x = x as f32;
        self.texture_source_rect.y = y as f32;
    }
}

impl Construction {
    fn texture_offset_x(&self) -> i32 {
        *self as i32
    }
}

impl TileSet<ConstructionTile> {
    pub fn update_tile(&mut self, row: usize, col: usize, new_biome: Construction) {
        if row >= self.tiles.len() || col >= self.tiles[row].len() { return }

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
    pub fn from_char(c: char) -> Self {
        *CHAR_TO_CONSTRUCTION.get(&c).unwrap_or(&Construction::Nothing)
    }

    pub fn to_char(self) -> char {
        *CONSTRUCTION_TO_CHAR.get(&self).unwrap_or(&'0')
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
            texture_source_rect: FRect::square_from_origin(1.0) 
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
            Construction::WineTree => false,
            Construction::SolarPanel => false,
            Construction::Pipe => false,
            Construction::BroadleafPurple => true,
            Construction::WoodenWall => true,
            Construction::SnowPile => false,
            Construction::SnowyForest => true,
            Construction::Darkness15 => false,
            Construction::Darkness30 => false,
            Construction::Darkness45 => false,
            Construction::SlopeGreenTopLeft => true,
            Construction::SlopeGreenTopRight => true,
            Construction::SlopeGreenBottomRight => true,
            Construction::SlopeGreenBottomLeft => true,
            Construction::SlopeGreenBottom => true,
            Construction::SlopeGreenTop => true,
            Construction::SlopeGreenLeft => true,
            Construction::SlopeGreenRight => true,
            Construction::SlopeRockTopLeft => true,
            Construction::SlopeRockTopRight => true,
            Construction::SlopeRockBottomRight => true,
            Construction::SlopeRockBottomLeft => true,
            Construction::SlopeRockBottom => true,
            Construction::SlopeRockTop => true,
            Construction::SlopeRockLeft => true,
            Construction::SlopeRockRight => true,
            Construction::SlopeSandTopLeft => true,
            Construction::SlopeSandTopRight => true,
            Construction::SlopeSandBottomRight => true,
            Construction::SlopeSandBottomLeft => true,
            Construction::SlopeSandBottom => true,
            Construction::SlopeSandTop => true,
            Construction::SlopeSandLeft => true,
            Construction::SlopeSandRight => true,
            Construction::SlopeDarkRockTopLeft => true,
            Construction::SlopeDarkRockTopRight => true,
            Construction::SlopeDarkRockBottomRight => true,
            Construction::SlopeDarkRockBottomLeft => true,
            Construction::SlopeDarkRockBottom => true,
            Construction::SlopeDarkRockTop => true,
            Construction::SlopeDarkRockLeft => true,
            Construction::SlopeDarkRockRight => true,
        }
    }
}