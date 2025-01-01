use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use lazy_static::lazy_static;

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
    pub static ref BIOME_ENCODINGS: Vec<(char, Biome)> = vec![
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

    pub static ref NUMBER_OF_BIOMES: i32 = BIOME_ENCODINGS.len() as i32;
    static ref CHAR_TO_BIOME: HashMap<char, Biome> = BIOME_ENCODINGS.clone().into_iter().collect();
    static ref BIOME_TO_CHAR: HashMap<Biome, char> = BIOME_ENCODINGS.clone().into_iter().map(|(char, biome)| (biome, char)).collect();
}

impl Biome {    
    pub fn number_of_combinations() -> i32 {
        15
    }

    pub fn texture_index(&self) -> i32 {
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

    pub fn is_same(&self, other: Biome) -> bool {
        self == &other || (self.is_light_grass() && other.is_light_grass())
    }

    pub fn is_light_grass(&self) -> bool {
        matches!(self, Biome::Grass)
    }

    pub fn is_dark_grass(&self) -> bool {
        matches!(self, Biome::DarkGrass)
    }

    pub fn is_liquid(&self) -> bool {
        matches!(self, Biome::Water | Biome::DarkWater | Biome::Lava)
    }
    
    pub fn stops_bullets(&self) -> bool {
        matches!(self, Biome::Nothing)
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