use std::{collections::VecDeque, ffi::c_char};


use crate::{constants::SPRITE_SHEET_MENU, features::animated_sprite::AnimatedSprite, hstack, spacing, string_to_c_char, text, texture, ui::{components::{empty_view, BordersTextures, NonColor, NonColorC, Spacing, TextureInfo, Typography, View, COLOR_BLACK, COLOR_TRANSPARENT}, scaffold::scaffold}, utils::{animator::Animator, rect::IntRect}, vstack};

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub enum ToastMode {
    Regular = 0,
    Hint
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
    mode: ToastMode,
    sprite: Option<AnimatedSprite>,
    queue: VecDeque<Toast>,
}

impl ToastDisplay {
    pub fn new() -> Self {
        Self {
            animator: Animator::new(),
            text: "".to_string(),
            mode: ToastMode::Regular,
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
        self.animator.animate(0.0, 1.0, toast.mode.duration());
        self.text = toast.text;
        self.mode = toast.mode;

        if let Some(image) = toast.image {
            self.sprite = Some(AnimatedSprite::new(image.sprite_sheet_id, image.sprite_frame, image.number_of_frames));
        } else {
            self.sprite = None;
        }
        
    }
}

impl ToastMode {
    fn duration(&self) -> f32 {
        match self {
            ToastMode::Hint => 1.8,
            ToastMode::Regular => 1.0
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
    
    pub fn hint(text: String) -> Self {
        Toast { text, mode: ToastMode::Hint, image: None }
    }
    
    pub fn hint_with_image(text: String, image: ToastImage) -> Self {
        Toast { text, mode: ToastMode::Hint, image: Some(image) }
    }
}

impl ToastDisplay {
    pub fn hint_toast_ui(&self) -> View { 
        if matches!(self.mode, ToastMode::Hint) {       
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
                self.background_color(), 
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

            if matches!(self.mode, ToastMode::Hint) {
                hstack!(Spacing::MD, image, text)
            } else {
                hstack!(Spacing::MD, text, image)
            }
        } else {
            text
        }
    }

    fn border_texture(&self) -> BordersTextures {
        if matches!(self.mode, ToastMode::Hint) {
            TOAST_HINT_BORDERS_TEXTURES
        } else {
            TOAST_BORDERS_TEXTURES
        }
    }

    fn background_color(&self) -> NonColor {
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

impl ToastDisplay {
    pub fn descriptor_c(&self) -> ToastDescriptorC {
        if self.animator.is_active {
            ToastDescriptorC { 
                background_color: NonColorC::new(&self.background_color()), 
                text: string_to_c_char(self.text.clone()), 
                mode: self.mode, 
                image: if let Some(sprite) = self.sprite.clone() {
                    ToastImageDescriptorC {
                        sprite_sheet_id: sprite.sheet_id,
                        texture_frame: sprite.texture_source_rect()
                    }
                } else {
                    ToastImageDescriptorC::empty()
                }
            }
        } else {
            ToastDescriptorC { 
                background_color: NonColorC::new(&COLOR_TRANSPARENT), 
                text: string_to_c_char("".to_owned()), 
                mode: ToastMode::Regular, 
                image: ToastImageDescriptorC::empty()
            }
        }
    }
}

#[repr(C)]
pub struct ToastDescriptorC {
    pub background_color: NonColorC,
    pub text: *const c_char,
    pub mode: ToastMode,
    pub image: ToastImageDescriptorC,
}

#[repr(C)]
pub struct ToastImageDescriptorC {
    pub sprite_sheet_id: u32,
    pub texture_frame: IntRect
}

impl ToastImageDescriptorC {
    fn empty() -> Self {
        Self {
            sprite_sheet_id: 0,
            texture_frame: IntRect::square_from_origin(1)
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

const TOAST_HINT_BORDERS_TEXTURES: BordersTextures = BordersTextures {
    corner_top_left:     TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 0, w: 1, h: 1 } },
    corner_top_right:    TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 0, w: 1, h: 1 } },
    corner_bottom_right: TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 2, w: 1, h: 1 } },
    corner_bottom_left:  TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 2, w: 1, h: 1 } },
    side_top:            TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 7, y: 0, w: 1, h: 1 } },
    side_right:          TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 8, y: 1, w: 1, h: 1 } },
    side_bottom:         TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 7, y: 2, w: 1, h: 1 } },
    side_left:           TextureInfo { key: SPRITE_SHEET_MENU, source_rect: IntRect { x: 6, y: 1, w: 1, h: 1 } },
};