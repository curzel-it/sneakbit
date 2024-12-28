use std::collections::VecDeque;

use game_core::{constants::SPRITE_SHEET_MENU, features::{animated_sprite::AnimatedSprite, toasts::{Toast, ToastMode}}, hstack, next_toast, spacing, text, texture, ui::{components::{empty_view, BordersTextures, NonColor, Spacing, TextureInfo, Typography, View, WithAlpha, COLOR_TOAST_BACKGROUND}, scaffold::scaffold}, utils::{animator::Animator, rect::IntRect}, vstack};

use crate::GameContext;

pub fn update_toasts(context: &mut GameContext, time_since_last_update: f32) {
    if let Some(new_toast) = next_toast() {
        context.toast.show(new_toast)
    } 
    context.toast.update(time_since_last_update);
}

pub struct ToastDisplay {
    text: String,
    animator: Animator,
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

    fn show(&mut self, toast: &Toast) {
        if self.animator.is_active {
            if self.text == toast.text {
                return
            }
            if matches!(toast.mode, ToastMode::Hint | ToastMode::LongHint) {
                self.show_now(toast.clone());
                return
            }
            if self.queue.iter().any(|queued| queued.text == toast.text) {
                return
            }
            self.queue.push_back(toast.clone());
        } else {
            self.show_now(toast.clone());
        }
    }

    fn update(&mut self, time_since_last_update: f32) {
        self.animator.update(time_since_last_update);
        
        if let Some(sprite) = self.sprite.as_mut() { 
            sprite.update(time_since_last_update) 
        }

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

impl ToastDisplay {
    pub fn hint_toast_ui(&self) -> View { 
        if matches!(self.mode, ToastMode::Hint | ToastMode::LongHint) {       
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
        match self.mode { 
            ToastMode::Hint | ToastMode::LongHint => TOAST_HINT_BORDERS_TEXTURES,
            ToastMode::Regular => TOAST_BORDERS_TEXTURES
        }
    }

    fn background_color(&self) -> NonColor {
        if self.animator.current_value < 0.05 {
            let alpha = 1.0 - (0.05 - self.animator.current_value) * 20.0;            
            COLOR_TOAST_BACKGROUND.with_alpha(alpha)
        } else if self.animator.current_value < 0.95 {
            COLOR_TOAST_BACKGROUND
        } else {
            let alpha = (1.0 - self.animator.current_value) * 20.0;
            COLOR_TOAST_BACKGROUND.with_alpha(alpha)
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