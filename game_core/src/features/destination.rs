use serde::{Deserialize, Serialize};

use crate::utils::directions::Direction;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Destination {
    pub world: u32,
    
    #[serde(default)]
    pub x: f32,
    
    #[serde(default)]
    pub y: f32,
    
    #[serde(default)]
    pub direction: Direction
}

impl Destination {
    pub fn new_ex(world: u32, x: f32, y: f32, direction: Direction) -> Self {
        Self { world, x, y, direction }
    }

    pub fn new(world: u32, x: f32, y: f32) -> Self {
        Self::new_ex(world, x, y, Direction::None)
    }

    pub fn nearest(world: u32) -> Self {
        Self::new(world, 0.0, 0.0)
    }
}