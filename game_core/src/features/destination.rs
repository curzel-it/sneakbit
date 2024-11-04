use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Destination {
    pub world: u32,
    pub x: i32,
    pub y: i32
}

impl Destination {
    pub fn new(world: u32, x: i32, y: i32) -> Self {
        Self { world, x, y }
    }

    pub fn nearest(world: u32) -> Self {
        Self::new(world, 0, 0)
    }
}