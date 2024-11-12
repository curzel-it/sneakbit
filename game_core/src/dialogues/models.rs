use serde::{Deserialize, Serialize};

use crate::{entities::species::{species_by_id, SpeciesId}, lang::localizable::LocalizableText};

pub type EntityDialogues = Vec<Dialogue>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dialogue {
    pub text: String,
    
    #[serde(default="always")]
    pub key: String,
    
    #[serde(default)]
    pub expected_value: u32,
    
    #[serde(default)]
    pub reward: Option<SpeciesId>
}

impl Dialogue {
    pub fn localized_text(&self) -> String {
        self.text.localized()
    }

    pub fn localized_reward_text(&self) -> String {
        if let Some(reward_species_id) = self.reward {
            let species_name = species_by_id(reward_species_id).localized_name();
            let text = "dialogue.reward_received".localized();
            text.replace("%s", &species_name)
        } else {
            "".to_owned()
        }
    }
}

impl Dialogue {
    pub fn empty() -> Dialogue {
        Dialogue {
            key: "always".to_owned(),
            expected_value: 0,
            text: "empty_dialogue".localized(),
            reward: None
        }
    }
}

fn always() -> String {
    "always".to_owned()
}