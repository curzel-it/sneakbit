
use crate::{constants::SPRITE_SHEET_MENU, input::keyboard_events_provider::KeyboardEventsProvider, features::state_updates::WorldStateUpdate, lang::localizable::LocalizableText, ui::{components::{empty_view, BordersTextures, TextureInfo, View, WithAlpha, COLOR_MENU_BACKGROUND}, scaffold::scaffold}, utils::rect::IntRect};

use super::menu::{Menu, MenuItem, MenuUpdate};

pub struct ConfirmationDialog {
    pub menu: Menu<ConfirmationOption>,
    pub on_confirm: Vec<WorldStateUpdate>
}

#[derive(Debug, Copy, Clone)]
pub enum ConfirmationOption {
    YesConfirm,
    NoCancel,
}

impl MenuItem for ConfirmationOption {
    fn title(&self) -> String {
        match self {
            ConfirmationOption::YesConfirm => "confirmation.confirm".localized(),
            ConfirmationOption::NoCancel => "confirmation.cancel".localized(),
        }
    }
}

impl ConfirmationDialog {
    pub fn new() -> Self {
        Self {
            on_confirm: vec![],
            menu: Menu::new(
                "".to_string(), 
                vec![ConfirmationOption::YesConfirm, ConfirmationOption::NoCancel]
            )
        }
    }

    pub fn is_open(&self) -> bool {
        self.menu.is_open
    }

    pub fn show(&mut self, title: &str, text: &str, on_confirm: &[WorldStateUpdate]) {
        if self.menu.title == title {
            return 
        }
        self.on_confirm = on_confirm.to_owned();
        self.menu.title = title.to_string();
        self.menu.text = Some(text.to_string());
        self.menu.show();
    }

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider, time_since_last_update: f32) -> MenuUpdate {
        self.menu.update(keyboard, time_since_last_update);

        if self.menu.selection_has_been_confirmed {
            let selection = self.menu.selected_item();

            self.menu.title = "".to_owned();
            self.menu.clear_selection();
            self.menu.close();

            if matches!(selection, ConfirmationOption::YesConfirm) {
                return (false, self.on_confirm.clone())
            } else {
                return (false, vec![])
            }
        }
        (self.menu.is_open, vec![])
    }

    pub fn select_option_at_index(&mut self, index: usize) {
        self.menu.selected_index = index;
    }
}

const ALERT_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 0, w: 1, h: 1 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 2, w: 1, h: 1 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 2, w: 1, h: 1 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 7, y: 0, w: 1, h: 1 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 1, w: 1, h: 1 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 7, y: 2, w: 1, h: 1 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 1, w: 1, h: 1 } },
};

impl ConfirmationDialog {
    pub fn ui(&self) -> View {
        if self.menu.is_open {       
            scaffold(
                true, 
                COLOR_MENU_BACKGROUND.with_alpha(self.menu.animator.current_value), 
                Some(ALERT_BORDERS_TEXTURES),
                self.menu.menu_contents()
            )
        } else {
            empty_view()
        }
    }
}