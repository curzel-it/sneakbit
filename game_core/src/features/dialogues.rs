use serde::{Deserialize, Serialize};

use crate::{constants::SPRITE_SHEET_INVENTORY, entities::species::{species_by_id, SpeciesId}, game_engine::{state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{has_dialogue_reward_been_collected, set_dialogue_read, set_dialogue_reward_collected}}, lang::localizable::LocalizableText, menus::toasts::{Toast, ToastImage}};

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
            key: always(),
            expected_value: 0,
            text: "empty_dialogue".localized(),
            reward: None
        }
    }
}

fn always() -> String {
    "always".to_owned()
}

impl Dialogue {
    pub fn handle_reward(&self) -> Vec<WorldStateUpdate> {
        set_dialogue_read(&self.text);       

        if let Some(reward) = self.reward {
            if !has_dialogue_reward_been_collected(&self.text) {
                set_dialogue_reward_collected(&self.text);
                let species = species_by_id(reward);
                
                return vec! [
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::Toast(
                            Toast::regular_with_image(
                                self.localized_reward_text(),
                                ToastImage::static_image(
                                    species.inventory_sprite_frame(), 
                                    SPRITE_SHEET_INVENTORY
                                )
                            )
                        )
                    ),
                    WorldStateUpdate::EngineUpdate(EngineStateUpdate::AddToInventory(reward)),
                    WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)
                ]
            }
        }
        vec![]
    }
}