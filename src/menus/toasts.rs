use std::collections::VecDeque;

use raylib::color::Color;

use crate::{constants::SPRITE_SHEET_MENU, text, ui::{components::{empty_view, BordersTextures, Typography, TextureInfo, View}, scaffold::scaffold}, utils::{animator::Animator, rect::Rect}};

#[derive(Debug, Clone, Copy)]
pub enum ToastMode {
    Regular,
    Important
}

pub struct ToastDisplay {
    animator: Animator,
    text: String,
    mode: ToastMode,
    queue: VecDeque<(String, ToastMode)>,
}

impl ToastDisplay {
    pub fn new() -> Self {
        Self {
            animator: Animator::new(),
            text: "".to_string(),
            mode: ToastMode::Regular,
            queue: VecDeque::new(),
        }
    }

    pub fn show(&mut self, text: &str, mode: &ToastMode) {
        if self.animator.is_active {
            if self.text == text {
                return;
            }
            self.queue.push_back((text.to_string(), *mode));
        } else {
            self.animator.animate(0.0, 1.0, 2.5);
            self.text = text.to_string();
            self.mode = *mode;
        }
    }

    pub fn update(&mut self, time_since_last_update: f32) {
        self.animator.update(time_since_last_update);

        if !self.animator.is_active && !self.queue.is_empty() {
            if let Some((next_text, mode)) = self.queue.pop_front() {
                self.animator.animate(0.0, 1.0, 2.5);
                self.text = next_text;
                self.mode = mode;
            }
        }
    }
}

impl ToastDisplay {
    pub fn important_toast_ui(&self) -> View { 
        if self.animator.is_active && matches!(self.mode, ToastMode::Important) {            
            scaffold(
                false, 
                self.background_color(), 
                Some(TOAST_IMPORTANT_BORDERS_TEXTURES),
                text!(Typography::Regular, self.text.clone())
            )
        } else {
            empty_view()
        }
    }

    pub fn regular_toast_ui(&self) -> View { 
        if self.animator.is_active && matches!(self.mode, ToastMode::Regular) {            
            scaffold(
                false, 
                self.background_color(), 
                Some(TOAST_BORDERS_TEXTURES),
                text!(Typography::Regular, self.text.clone())
            )
        } else {
            empty_view()
        }
    }

    fn background_color(&self) -> Color {
        if self.animator.current_value < 0.05 {
            let alpha = 1.0 - (0.05 - self.animator.current_value) * 20.0;
            Color::BLACK.alpha(alpha)
        } else if self.animator.current_value < 0.95 {
            Color::BLACK
        } else {
            let alpha = (1.0 - self.animator.current_value) * 20.0;
            Color::BLACK.alpha(alpha)
        }        
    }
}

const TOAST_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 3, y: 0, w: 1, h: 1 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 5, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 5, y: 2, w: 1, h: 1 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 3, y: 2, w: 1, h: 1 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 4, y: 0, w: 1, h: 1 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 5, y: 1, w: 1, h: 1 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 4, y: 2, w: 1, h: 1 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 3, y: 1, w: 1, h: 1 } },
};

const TOAST_IMPORTANT_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 6, y: 0, w: 1, h: 1 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 8, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 8, y: 2, w: 1, h: 1 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 6, y: 2, w: 1, h: 1 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 7, y: 0, w: 1, h: 1 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 8, y: 1, w: 1, h: 1 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 7, y: 2, w: 1, h: 1 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: Rect { x: 6, y: 1, w: 1, h: 1 } },
};