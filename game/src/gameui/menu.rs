
use std::{ffi::{c_char, CString}, ptr::null};

use game_core::{utils::rect::IntRect, ui::scaffold::scaffold, ui::components::{empty_view, BordersTextures, TextureInfo, COLOR_MENU_BACKGROUND}, constants::SPRITE_SHEET_MENU, input::keyboard_events_provider::KeyboardEventsProvider, features::state_updates::WorldStateUpdate, text, ui::components::{Spacing, Typography, View}, vstack};

pub struct Menu<Item: MenuItem> {
    pub title: String,
    pub text: Option<String>,
    pub original_text: Option<String>,
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

pub type MenuUpdate = (bool, Vec<WorldStateUpdate>);

impl<Item: MenuItem> Menu<Item> {
    pub fn new(title: String, items: Vec<Item>) -> Self {
        Self {
            title,
            text: None,
            original_text: None,
            is_open: false,
            selected_index: 0,
            selection_has_been_confirmed: false,
            items,
            uses_backdrop: true,
            visible_item_count: 6,
            scroll_offset: 0, 
        }
    }

    pub fn empty() -> Self {
        Self::empty_with_title("".to_string())
    }

    pub fn empty_with_title(title: String) -> Self {
        Self::new(title, vec![])
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

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider) -> MenuUpdate {
        if self.is_open {
            return (true, self.do_update(keyboard))
        }
        (false, vec![])
    }
}

impl<Item: MenuItem> Menu<Item> {
    fn do_update(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed_by_anyone(){
            self.close();
        }
    
        let max_index = self.items.len() - 1;
        
        if keyboard.is_direction_up_pressed_by_anyone() && self.selected_index > 0 {
            self.selected_index -= 1;

            if self.selected_index < self.scroll_offset {
                self.scroll_offset -= 1;
            }
        }
    
        if keyboard.is_direction_down_pressed_by_anyone() && self.selected_index < max_index {
            self.selected_index += 1;

            if self.selected_index >= self.scroll_offset + self.visible_item_count {
                self.scroll_offset += 1;
            }
        }
    
        if keyboard.has_confirmation_been_pressed_by_anyone() {
            self.selection_has_been_confirmed = true;
        }    
        vec![]
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

#[repr(C)]
pub struct MenuDescriptorC {
    pub is_visible: bool,
    pub title: *const c_char,
    pub text: *const c_char,
    pub options: *const MenuDescriptorItemC,
    pub options_count: u32
}

#[repr(C)]
pub struct MenuDescriptorItemC {
    pub title: *const c_char,
}

impl MenuDescriptorC {
    pub fn empty() -> Self {
        Self {
            is_visible: false,
            title: null(),
            text: null(),
            options: null(),
            options_count: 0
        }
    }
}

impl<Item: MenuItem> Menu<Item> {
    pub fn descriptor_c(&self) -> MenuDescriptorC {
        let c_title = CString::new(self.title.clone())
            .expect("Failed to convert title to CString");
        let leaked_title = c_title.into_raw();

        let c_text = CString::new(self.actual_text())
            .expect("Failed to convert text to CString");
        let leaked_text = c_text.into_raw();

        let mut c_options = Vec::with_capacity(self.items.len());
        for item in &self.items {
            let c_item_title = CString::new(item.title())
                .expect("Failed to convert option title to CString");
            let leaked_item_title = c_item_title.into_raw();

            let c_item = MenuDescriptorItemC {
                title: leaked_item_title,
            };
            c_options.push(c_item);
        }

        let options_ptr = c_options.as_ptr();
        let options_len = c_options.len();
        std::mem::forget(c_options); 
        
        MenuDescriptorC {
            is_visible: true,
            title: leaked_title,
            text: leaked_text,
            options: options_ptr,
            options_count: options_len as u32,
        }
    }

    fn actual_text(&self) -> String {
        if let Some(original_text) = self.original_text.clone() {
            return original_text
        }
        if let Some(text) = self.text.clone() {
            return text
        }
        "".to_owned()
    }
}