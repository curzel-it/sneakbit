use serde::{Deserialize, Serialize};

use crate::utils::directions::Direction;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Destination {
    pub world: u32,
    
    #[serde(default)]
    pub x: i32,
    
    #[serde(default)]
    pub y: i32,
    
    #[serde(default)]
    pub direction: Direction
}

impl Destination {
    pub fn new(world: u32, x: i32, y: i32) -> Self {
        Self { world, x, y, direction: Direction::Unknown }
    }

    pub fn nearest(world: u32) -> Self {
        Self::new(world, 0, 0)
    }
}