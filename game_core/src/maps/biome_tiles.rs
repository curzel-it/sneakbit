use std::collections::HashMap;

use lazy_static::lazy_static;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer, de::Deserializer};
use crate::utils::{directions::Direction, rect::IntRect};
use super::tiles::{SpriteTile, TileSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[derive(Default)]
#[repr(i32)]
pub enum Biome {
    Water = 0,
    Desert = 1,
    Grass = 2,
    Rock = 3,
    Snow = 4,
    LightWood = 5,
    DarkWood = 6,
    #[default]
    Nothing = 7,
    DarkRock = 8,
    Ice = 9,
    DarkGrass = 10,
    RockPlates = 11,
    Lava = 12,
    Farmland = 13,
    DarkWater = 14,
    DarkSand = 15,
    SandPlates = 16
}

lazy_static! {
    static ref BIOME_ENCODINGS: Vec<(char, Biome)> = vec![
        ('0', Biome::Nothing),
        ('1', Biome::Grass),
        ('2', Biome::Water),
        ('3', Biome::Rock),
        ('4', Biome::Desert),
        ('5', Biome::Snow),
        ('6', Biome::DarkWood),
        ('7', Biome::LightWood),
        ('8', Biome::DarkRock),
        ('9', Biome::Ice),
        ('A', Biome::DarkGrass),
        ('B', Biome::RockPlates),
        ('G', Biome::Lava),
        ('H', Biome::Farmland),
        ('J', Biome::DarkWater),
        ('K', Biome::DarkSand),
        ('L', Biome::SandPlates)
    ];

    static ref NUMBER_OF_BIOMES: i32 = BIOME_ENCODINGS.len() as i32;
    static ref CHAR_TO_BIOME: HashMap<char, Biome> = BIOME_ENCODINGS.clone().into_iter().collect();
    static ref BIOME_TO_CHAR: HashMap<Biome, char> = BIOME_ENCODINGS.clone().into_iter().map(|(char, biome)| (biome, char)).collect();
}

#[derive(Default, Debug, Clone)]
#[repr(C)]
pub struct BiomeTile {
    pub tile_type: Biome,
    pub tile_up_type: Biome,
    pub tile_right_type: Biome,
    pub tile_down_type: Biome,
    pub tile_left_type: Biome,
    pub texture_offset_x: i32,
    pub texture_offset_y: i32,
}

impl SpriteTile for BiomeTile {
    fn texture_source_rect(&self, variant: i32) -> IntRect {
        IntRect::new(
            self.texture_offset_x,
            self.texture_offset_y + variant * *NUMBER_OF_BIOMES,
            1, 
            1
        )
    }
}

impl BiomeTile {
    pub fn is_obstacle(&self) -> bool {
        matches!(&self.tile_type, Biome::Water | Biome::Nothing | Biome::Lava | Biome::DarkWater)
    }

    pub fn setup_neighbors(&mut self, up: Biome, right: Biome, bottom: Biome, left: Biome) {
        self.tile_up_type = up;
        self.tile_right_type = right;
        self.tile_down_type = bottom;
        self.tile_left_type = left;        
        self.setup_textures();    
    }

    fn setup_textures(&mut self) {
        self.texture_offset_x = self.texture_index_for_neighbors();
        self.texture_offset_y = self.tile_type.texture_index(); 
    }

    fn texture_index_for_neighbors(&self) -> i32 {
        if let Some((neighbor, directions)) = self.best_neighbor() {
            let with_overlaps = neighbor.texture_index() * Biome::number_of_combinations() + self.texture_index_for_directions(&directions) + 1;
            let completely_filled: i32 = 0;

            if self.tile_type.is_liquid() {
                return completely_filled
            }
            if neighbor.is_liquid() {
                return with_overlaps
            }
            if self.tile_type.is_light_grass() {     
                return completely_filled
            }
            if neighbor.is_light_grass() {     
                return with_overlaps
            }
            if self.tile_type.is_dark_grass() && !neighbor.is_light_grass() {
                return completely_filled
            }

            return match (self.tile_type, neighbor) {
                (Biome::Water, Biome::Desert) => completely_filled,
                (Biome::Water, Biome::Rock) => completely_filled,
                (Biome::DarkWater, Biome::DarkSand) => completely_filled,
                (Biome::DarkWater, Biome::Desert) => completely_filled,
                (Biome::Lava, Biome::DarkSand) => completely_filled,
                (Biome::Lava, Biome::Desert) => completely_filled,
                (Biome::Rock, Biome::Snow) => completely_filled,
                (Biome::Water, Biome::DarkRock) => completely_filled,
                (Biome::DarkWater, Biome::DarkRock) => completely_filled,
                (Biome::Lava, Biome::DarkRock) => completely_filled,
                (Biome::DarkSand, Biome::Snow) => completely_filled,
                (Biome::Desert, Biome::Snow) => completely_filled,
                (Biome::Desert, Biome::DarkSand) => completely_filled,
                (Biome::Rock, Biome::Desert) => completely_filled,
                (Biome::Rock, Biome::DarkSand) => completely_filled,
                (Biome::DarkRock, Biome::Snow) => completely_filled,
                (Biome::DarkRock, Biome::Desert) => completely_filled,
                (Biome::DarkRock, Biome::DarkSand) => completely_filled,
                (_, Biome::Nothing) => completely_filled,
                _ => with_overlaps
            }
        }        
        0 
    }

    fn texture_index_for_directions(&self, directions: &[Direction]) -> i32 {
        if directions.len() == 1 {
            match directions[0] {
                Direction::Up => return 0,
                Direction::Right => return 1,
                Direction::Down => return 2,
                Direction::Left => return 3,
                _ => {}
            }
        }
        if directions.len() == 2 {
            match (directions[0], directions[1]) {
                (Direction::Up, Direction::Left) => return 4,
                (Direction::Up, Direction::Right) => return 5,
                (Direction::Right, Direction::Down) => return 6,
                (Direction::Down, Direction::Left) => return 7,
                (Direction::Up, Direction::Down) => return 13,
                (Direction::Right, Direction::Left) => return 14,
                _ => {}
            }
        }
        if directions.len() == 3 {
            match (directions[0], directions[1], directions[2]) {
                (Direction::Up, Direction::Right, Direction::Down) => return 8,
                (Direction::Right, Direction::Down, Direction::Left) => return 9,
                (Direction::Up, Direction::Down, Direction::Left) => return 10,
                (Direction::Up, Direction::Right, Direction::Left) => return 11,
                _ => {}
            }
        }
        if directions.len() == 4 {
            return 12;
        }
        0
    }

    fn best_neighbor(&self) -> Option<(Biome, Vec<Direction>)> {
        let up = self.contact_directions_with_biome(self.tile_up_type);
        let right = self.contact_directions_with_biome(self.tile_right_type);
        let down = self.contact_directions_with_biome(self.tile_down_type);
        let left = self.contact_directions_with_biome(self.tile_left_type);

        let upc = up.len();
        let rightc = right.len();
        let downc = down.len();
        let leftc = left.len();

        for i in 1..=3 {
            if !self.tile_up_type.is_same(self.tile_type) && upc >= 3-i {
                return Some((self.tile_up_type, up));
            }
            if !self.tile_right_type.is_same(self.tile_type) && rightc >= 3-i {
                return Some((self.tile_right_type, right));
            }
            if !self.tile_down_type.is_same(self.tile_type) && downc >= 3-i {
                return Some((self.tile_down_type, down));
            }
            if !self.tile_left_type.is_same(self.tile_type) && leftc >= 3-i {
                return Some((self.tile_left_type, left));
            }
        }
        None
    }

    fn contact_directions_with_biome(&self, biome: Biome) -> Vec<Direction> {
        let mut contacts: Vec<Direction> = vec![];
        if self.tile_up_type == biome { contacts.push(Direction::Up); }
        if self.tile_right_type == biome { contacts.push(Direction::Right); }
        if self.tile_down_type == biome { contacts.push(Direction::Down); }
        if self.tile_left_type == biome { contacts.push(Direction::Left); }
        contacts
    }
}

impl Biome {    
    fn number_of_combinations() -> i32 {
        15
    }

    fn texture_index(&self) -> i32 {
        match self {
            Biome::Water => 0,
            Biome::Desert => 1,
            Biome::Grass => 2,
            Biome::Rock => 3,
            Biome::Snow => 4,
            Biome::LightWood => 5,
            Biome::DarkWood => 6,
            Biome::Nothing => 7,
            Biome::DarkRock => 8,
            Biome::Ice => 9,
            Biome::DarkGrass => 10,
            Biome::RockPlates => 11,
            Biome::Lava => 12,
            Biome::Farmland => 13,
            Biome::DarkWater => 14,
            Biome::DarkSand => 15,
            Biome::SandPlates => 16
        }
    }

    fn is_same(&self, other: Biome) -> bool {
        self == &other || (self.is_light_grass() && other.is_light_grass())
    }

    fn is_light_grass(&self) -> bool {
        matches!(self, Biome::Grass)
    }

    fn is_dark_grass(&self) -> bool {
        matches!(self, Biome::DarkGrass)
    }

    fn is_liquid(&self) -> bool {
        matches!(self, Biome::Water | Biome::DarkWater | Biome::Lava)
    }
}

impl Biome {
    pub fn stops_bullets(&self) -> bool {
        matches!(self, Biome::Nothing)
    }
}

impl TileSet<BiomeTile> {
    pub fn update_tile(&mut self, row: usize, col: usize, new_biome: Biome) {
        if row >= self.tiles.len() || col >= self.tiles[0].len() {
            return
        }
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

impl Biome {
    pub fn from_char(c: char) -> Self {
        *CHAR_TO_BIOME.get(&c).unwrap_or(&Biome::Nothing)
    }

    pub fn to_char(self) -> char {
        *BIOME_TO_CHAR.get(&self).unwrap_or(&'0')
    }
}

impl BiomeTile {
    pub fn from_data(data: char) -> Self {
        let mut tile = Self { 
            tile_type: Biome::from_char(data), 
            tile_up_type: Biome::Nothing,
            tile_right_type: Biome::Nothing,
            tile_down_type: Biome::Nothing,
            tile_left_type: Biome::Nothing,
            texture_offset_x: 0, 
            texture_offset_y: 0 
        };
        tile.setup_textures();
        tile
    }
}

impl Serialize for TileSet<BiomeTile> {    
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

impl<'de> Deserialize<'de> for TileSet<BiomeTile> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        #[derive(Deserialize)]
        struct TileSetData {
            tiles: Vec<String>,
            sheet_id: u32,
        }

        let data = TileSetData::deserialize(deserializer)?;

        let mut tiles: Vec<Vec<BiomeTile>> = data.tiles.into_iter().map(|tile_row| {
            tile_row.chars().map(|tile_char| {
                BiomeTile::from_data(tile_char)
            }).collect()
        }).collect();

        let rows = tiles.len();
        let columns = if rows > 0 { tiles[0].len() } else { 0 };

        for row in 0..rows {
            for col in 0..columns {
                let up = if row > 0 { tiles[row-1][col].tile_type } else { Biome::Nothing };
                let right = if col < columns - 1 { tiles[row][col+1].tile_type } else { Biome::Nothing };
                let down = if row < rows - 1 { tiles[row+1][col].tile_type } else { Biome::Nothing };
                let left = if col > 0 { tiles[row][col-1].tile_type } else { Biome::Nothing };

                tiles[row][col].setup_neighbors(up, right, down, left)
            }
        }

        Ok(TileSet::with_tiles(data.sheet_id, tiles))
    }
}