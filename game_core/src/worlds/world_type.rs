use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum WorldType {
    HouseInterior,
    Dungeon,
    Exterior
}