use game_core::{constants::SPRITE_SHEET_MENU, input::keyboard_events_provider::KeyboardEventsProvider, text, ui::{components::{empty_view, BordersTextures, Spacing, TextureInfo, Typography, View, COLOR_MENU_BACKGROUND}, scaffold::scaffold}, utils::rect::IntRect, vstack};

pub struct Menu<Item: MenuItem> {
    pub title: String,
    pub text: Option<String>,
    pub is_open: bool,
    pub selected_index: usize,
    pub selection_has_been_confirmed: bool,
    pub items: Vec<Item>,
    pub uses_backdrop: bool,
    pub visible_item_count: usize,
    pub scroll_offset: usize, 
}

pub trait MenuItem: Clone {
    fn title(&self) -> String;
}

impl<Item: MenuItem> Menu<Item> {
    pub fn new(title: String, items: Vec<Item>) -> Self {
        Self {
            title,
            text: None,
            is_open: false,
            selected_index: 0,
            selection_has_been_confirmed: false,
            items,
            uses_backdrop: true,
            visible_item_count: 6,
            scroll_offset: 0, 
        }
    }

    pub fn show(&mut self) {
        self.is_open = true;
    }

    pub fn close(&mut self) {
        self.scroll_offset = 0;
        self.is_open = false;
    }

    pub fn selected_item(&self) -> Item {
        self.items[self.selected_index].clone()
    }

    pub fn clear_selection(&mut self) {
        self.selected_index = 0;
        self.clear_confirmation();
    }

    pub fn clear_confirmation(&mut self) {
        self.selection_has_been_confirmed = false;
    }

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider) -> bool {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.close();
            return false
        }
    
        let max_index = self.items.len() - 1;
        
        if keyboard.is_direction_up_pressed_by_anyone() && self.selected_index > 0 {
            self.selected_index -= 1;

            if self.selected_index < self.scroll_offset {
                self.scroll_offset -= 1;
            }
        } else if keyboard.is_direction_down_pressed_by_anyone() && self.selected_index < max_index {
            self.selected_index += 1;

            if self.selected_index >= self.scroll_offset + self.visible_item_count {
                self.scroll_offset += 1;
            }
        } else if keyboard.has_confirmation_been_pressed_by_anyone() {
            self.selection_has_been_confirmed = true;
        }    
        self.is_open
    }
}

pub const MENU_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 0, y: 0, w: 1, h: 1 } },
    corner_top_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 2, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 2, y: 2, w: 1, h: 1 } },
    corner_bottom_left: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 0, y: 2, w: 1, h: 1 } },
    side_top: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 1, y: 0, w: 1, h: 1 } },
    side_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 2, y: 1, w: 1, h: 1 } },
    side_bottom: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 1, y: 2, w: 1, h: 1 } },
    side_left: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 0, y: 1, w: 1, h: 1 } },
};

impl<Item: MenuItem> Menu<Item> {
    pub fn ui(&self) -> View {
        if self.is_open {
            self.menu_ui()
        } else {
            empty_view()
        }
    }

    fn menu_ui(&self) -> View {
        scaffold(
            self.uses_backdrop, 
            COLOR_MENU_BACKGROUND, 
            Some(MENU_BORDERS_TEXTURES),
            self.menu_contents()
        )
    }

    pub fn menu_contents(&self) -> View {
        let start_index = self.scroll_offset;
        let end_index = (self.scroll_offset + self.visible_item_count).min(self.items.len());
    
        let visible_items: Vec<View> = self.items[start_index..end_index]
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let actual_index = start_index + i;
                if actual_index == self.selected_index {
                    text!(Typography::Selected, format!(" > {}", item.title()))
                } else {
                    text!(Typography::Regular, format!(" {}", item.title()))
                }
            })
            .collect();
    
        let mut children: Vec<View> = Vec::new();
    
        if self.scroll_offset > 0 {
            children.push(text!(Typography::Regular, "^".to_owned()));
        }
    
        children.extend(visible_items);
    
        if self.scroll_offset + self.visible_item_count < self.items.len() {
            children.push(text!(Typography::Regular, "...".to_owned()));
        }
        
        vstack!(
            Spacing::XL, 
            if self.title.is_empty() {
                empty_view()
            } else {
                text!(Typography::Title, self.title.clone())
            },
            if let Some(text) = self.text.clone() {
                text!(Typography::Regular, text)
            } else {
                empty_view()
            },
            View::VStack {
                spacing: Spacing::LG,
                children
            }
        )
    }
}