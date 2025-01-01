
use game_core::{constants::SPRITE_SHEET_MENU, input::keyboard_events_provider::KeyboardEventsProvider, lang::localizable::LocalizableText, ui::{components::{empty_view, BordersTextures, TextureInfo, View, COLOR_MENU_BACKGROUND}, scaffold::scaffold}, utils::rect::FRect};

use super::menu::{Menu, MenuItem};

pub struct ConfirmationDialog {
    pub menu: Menu<ConfirmationOption>,
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
            menu: Menu::new(
                "".to_string(), 
                vec![ConfirmationOption::YesConfirm, ConfirmationOption::NoCancel]
            )
        }
    }

    pub fn show(&mut self, title: &str, text: &str) {
        if self.menu.title == title {
            return 
        }
        self.menu.title = title.to_string();
        self.menu.text = Some(text.to_string());
        self.menu.show();
    }

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider) -> Option<ConfirmationOption> {
        self.menu.update(keyboard);

        if self.menu.selection_has_been_confirmed {
            let selection = self.menu.selected_item();
            self.menu.title = "".to_owned();
            self.menu.clear_selection();
            self.menu.close();
            Some(selection)
        } else {
            None
        }
    }
}

const ALERT_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 6.0, y: 0.0, w: 1.0, h: 1.0 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 8.0, y: 0.0, w: 1.0, h: 1.0 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 8.0, y: 2.0, w: 1.0, h: 1.0 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 6.0, y: 2.0, w: 1.0, h: 1.0 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 7.0, y: 0.0, w: 1.0, h: 1.0 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 8.0, y: 1.0, w: 1.0, h: 1.0 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 7.0, y: 2.0, w: 1.0, h: 1.0 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: FRect { x: 6.0, y: 1.0, w: 1.0, h: 1.0 } },
};

impl ConfirmationDialog {
    pub fn ui(&self) -> View {
        if self.menu.is_open {       
            scaffold(
                true, 
                COLOR_MENU_BACKGROUND, 
                Some(ALERT_BORDERS_TEXTURES),
                self.menu.menu_contents()
            )
        } else {
            empty_view()
        }
    }
}