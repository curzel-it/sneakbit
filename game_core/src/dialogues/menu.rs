use crate::{constants::SPRITE_SHEET_INVENTORY, dialogues::storage::{has_dialogue_reward_been_collected, set_dialogue_reward_collected}, entities::species::species_by_id, game_engine::{keyboard_events_provider::KeyboardEventsProvider, state_updates::{EngineStateUpdate, WorldStateUpdate}}, lang::localizable::LocalizableText, menus::{menu::{Menu, MenuItem}, toasts::{Toast, ToastImage}}, ui::components::View, utils::{animator::Animator, strings::wrap_text}};

use super::{models::Dialogue, storage::set_dialogue_read};

pub struct DialogueMenu {
    pub npc_id: u32,
    pub npc_name: String,
    pub dialogue: Dialogue,
    time_since_last_closed: f32,
    pub text_animator: Animator,
    pub text: String,
    pub menu: Menu<DialogueAnswerItem>,
    pub max_line_length: usize
}

#[derive(Clone)]
pub enum DialogueAnswerItem {
    Value(String)
}

impl MenuItem for DialogueAnswerItem {
    fn title(&self) -> String {
        match self {
            DialogueAnswerItem::Value(text) => text.clone()
        }
    }
}

impl DialogueMenu {
    pub fn new() -> Self {
        let mut options_menu = Menu::empty();
        options_menu.uses_backdrop = false;        

        Self {
            npc_id: 0,
            npc_name: "".to_string(),
            dialogue: Dialogue::empty(),
            time_since_last_closed: 1.0,
            text_animator: Animator::new(),
            text: "".to_owned(),
            menu: options_menu,
            max_line_length: 60
        }
    }

    pub fn show(&mut self, npc_id: u32, npc_name: &str, dialogue: &Dialogue) {
        if self.time_since_last_closed >= 0.3 {
            self.show_now(npc_id, npc_name, dialogue, false);
        }
    }

    fn show_now(&mut self, npc_id: u32, npc_name: &str, dialogue: &Dialogue, skip_animation: bool) {
        self.npc_id = npc_id;
        self.npc_name = npc_name.to_string();
        self.dialogue = dialogue.clone();       
        
        self.menu.title = format!("{: <45}", format!("{}:", self.npc_name));
        self.text = wrap_text(&self.dialogue.localized_text(), self.max_line_length).join("\n");

        self.text_animator.animate(0.0, 1.0, self.text.len() as f32 / 120.0);
        self.time_since_last_closed = 0.0;
        
        self.menu.items = vec![DialogueAnswerItem::Value("ok".localized())];

        if skip_animation {
            self.menu.show_no_animation();
        } else {
            self.menu.show();
        }        
    }

    pub fn update(
        &mut self,
        keyboard: &KeyboardEventsProvider,
        time_since_last_update: f32,
    ) -> (bool, Vec<WorldStateUpdate>) {
        self.text_animator.update(time_since_last_update);
        
        let animated_text_length = (self.text.len() as f32 * self.text_animator.current_value).round() as usize;
        let animated_text = self.text
            .char_indices()
            .take_while(|(idx, _)| *idx < animated_text_length)
            .map(|(_, c)| c)
            .collect::<String>();
        
        self.menu.text = Some(animated_text.to_owned());

        if !self.menu.is_open {
            self.time_since_last_closed += time_since_last_update;
        }
        if self.menu.is_open {
            self.menu.update(keyboard, time_since_last_update);
        }
        if self.menu.selection_has_been_confirmed {
            let updates = self.handle_answer();
            self.dialogue = Dialogue::empty();
            self.text = "".to_owned();
            self.menu.close();
            return (self.menu.is_open, updates)
        }

        (self.menu.is_open, vec![])
    }

    fn handle_answer(&mut self) -> Vec<WorldStateUpdate> {
        let dialogue_id = self.dialogue.text.as_str();
        set_dialogue_read(dialogue_id);       
        self.menu.clear_selection();

        if let Some(reward) = self.dialogue.reward {
            if !has_dialogue_reward_been_collected(dialogue_id) {
                set_dialogue_reward_collected(dialogue_id);
                let species = species_by_id(reward);
                
                vec! [
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::Toast(
                            Toast::regular_with_image(
                                self.dialogue.localized_reward_text(),
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
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    }

    pub fn is_open(&self) -> bool {
        self.menu.is_open
    }

    pub fn ui(&self) -> View {
        self.menu.ui()
    }    
}
