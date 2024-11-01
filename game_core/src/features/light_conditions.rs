use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
pub enum LightConditions {
    #[default]
    Day,
    Night,
    CantSeeShit
}