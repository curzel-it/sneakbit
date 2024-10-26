use std::collections::VecDeque;


use crate::{constants::SPRITE_SHEET_MENU, features::animated_sprite::AnimatedSprite, hstack, spacing, text, texture, ui::{components::{empty_view, BordersTextures, NonColor, Spacing, TextureInfo, Typography, View, COLOR_BLACK}, scaffold::scaffold}, utils::{animator::Animator, rect::IntRect}, vstack};

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub enum ToastMode {
    Regular = 0,
    Important
}

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct ToastImage {
    pub sprite_frame: IntRect,
    pub sprite_sheet_id: u32,
    pub number_of_frames: i32,    
}

#[derive(Debug, Clone)]
pub struct Toast {
    pub text: String,
    pub mode: ToastMode,
    pub image: Option<ToastImage>
}

pub struct ToastDisplay {
    pub animator: Animator,
    pub text: String,
    pub mode: ToastMode,
    pub image: Option<ToastImage>,
    pub sprite: Option<AnimatedSprite>,
    queue: VecDeque<Toast>,
}

impl ToastImage {
    pub fn empty() -> Self {
        Self { sprite_frame: IntRect { x: 0, y: 0, w: 1, h: 1 }, sprite_sheet_id: 1001, number_of_frames: 1 }
    }
}

impl ToastDisplay {
    pub fn new() -> Self {
        Self {
            animator: Animator::new(),
            text: "".to_string(),
            mode: ToastMode::Regular,
            image: None,
            sprite: None,
            queue: VecDeque::new(),
        }
    }

    pub fn show(&mut self, toast: &Toast) {
        if self.animator.is_active {
            if self.text == toast.text {
                return;
            }
            if self.queue.iter().any(|queued| queued.text == toast.text) {
                return;
            }
            self.queue.push_back(toast.clone());
        } else {
            self.show_now(toast.clone());
        }
    }

    pub fn update(&mut self, time_since_last_update: f32) {
        self.animator.update(time_since_last_update);
        if let Some(sprite) = self.sprite.as_mut() { sprite.update(time_since_last_update) }

        if !self.animator.is_active && !self.queue.is_empty() {
            if let Some(toast) = self.queue.pop_front() {
                self.show_now(toast);
            }
        }
    }

    fn show_now(&mut self, toast: Toast) {
        self.animator.animate(0.0, 1.0, 2.5);
        self.text = toast.text;
        self.mode = toast.mode;
        self.image = toast.image;

        if let Some(image) = toast.image {
            self.sprite = Some(AnimatedSprite::new(image.sprite_sheet_id, image.sprite_frame, image.number_of_frames));
        } else {
            self.sprite = None;
        }
        
    }
}

impl ToastImage {
    pub fn new(sprite_frame: IntRect, sprite_sheet_id: u32, number_of_frames: i32) -> Self {
        Self {
            sprite_frame,
            sprite_sheet_id,
            number_of_frames
        }
    }
    
    pub fn static_image(sprite_frame: IntRect, sprite_sheet_id: u32) -> Self {
        Self::new(sprite_frame, sprite_sheet_id, 1)
    }
}

impl Toast {
    pub fn regular(text: String) -> Self {
        Toast { text, mode: ToastMode::Regular, image: None }
    }
    
    pub fn regular_with_image(text: String, image: ToastImage) -> Self {
        Toast { text, mode: ToastMode::Regular, image: Some(image) }
    }
    
    pub fn important_with_image(text: String, image: ToastImage) -> Self {
        Toast { text, mode: ToastMode::Important, image: Some(image) }
    }
}

impl ToastDisplay {
    pub fn important_toast_ui(&self) -> View { 
        if matches!(self.mode, ToastMode::Important) {       
            self.ui()
        } else {
            empty_view()
        }
    }

    pub fn regular_toast_ui(&self) -> View { 
        if matches!(self.mode, ToastMode::Regular) {            
            self.ui()
        } else {
            empty_view()
        }
    }

    fn ui(&self) -> View { 
        if self.animator.is_active {            
            scaffold(
                false, 
                self.toast_background_color(), 
                Some(self.border_texture()),
                self.content()
            )
        } else {
            empty_view()
        }
    }

    fn content(&self) -> View {
        let text = text!(Typography::Regular, self.text.clone());

        if let Some(sprite) = &self.sprite {
            let image = texture!(sprite.sheet_id, sprite.frame, sprite.frame.size());
            
            let text = if sprite.frame.h > 1 && self.text.contains("\n") {
                vstack!(Spacing::Zero, spacing!(Spacing::LG), text)
            } else {
                vstack!(Spacing::Zero, spacing!(Spacing::SM), text)
            };

            if matches!(self.mode, ToastMode::Important) {
                hstack!(Spacing::MD, image, text)
            } else {
                hstack!(Spacing::MD, text, image)
            }
        } else {
            text
        }
    }

    fn border_texture(&self) -> BordersTextures {
        if matches!(self.mode, ToastMode::Important) {
            TOAST_IMPORTANT_BORDERS_TEXTURES
        } else {
            TOAST_BORDERS_TEXTURES
        }
    }

    pub fn toast_background_color(&self) -> NonColor {
        if self.animator.current_value < 0.05 {
            let alpha = 1.0 - (0.05 - self.animator.current_value) * 20.0;            
            (0, 0, 0, (255.0 * alpha) as u8)
        } else if self.animator.current_value < 0.95 {
            COLOR_BLACK
        } else {
            let alpha = (1.0 - self.animator.current_value) * 20.0;
            (0, 0, 0, (255.0 * alpha) as u8)
        }        
    }
}

const TOAST_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 3, y: 0, w: 1, h: 1 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 5, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 5, y: 2, w: 1, h: 1 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 3, y: 2, w: 1, h: 1 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 4, y: 0, w: 1, h: 1 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 5, y: 1, w: 1, h: 1 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 4, y: 2, w: 1, h: 1 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 3, y: 1, w: 1, h: 1 } },
};

const TOAST_IMPORTANT_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 0, w: 1, h: 1 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 2, w: 1, h: 1 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 2, w: 1, h: 1 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 7, y: 0, w: 1, h: 1 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 1, w: 1, h: 1 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 7, y: 2, w: 1, h: 1 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 1, w: 1, h: 1 } },
};