use std::os::raw::c_char;

use crate::utils::{rect::FRect, strings::str_to_c_char};

#[derive(Debug, Clone)]
pub struct Toast {
    pub text: String,
    pub mode: ToastMode,
    pub image: Option<ToastImage>
}

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub enum ToastMode {
    Regular = 0,
    Hint,
    LongHint
}

#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct ToastImage {
    pub sprite_frame: FRect,
    pub sprite_sheet_id: u32,
    pub number_of_frames: i32,    
}

impl Toast {    
    pub fn new(mode: ToastMode, text: String) -> Self {
        Self { text, mode, image: None }
    }

    pub fn new_with_image(mode: ToastMode, text: String, image: ToastImage) -> Self {
        Self { text, mode, image: Some(image) }
    }
}

impl ToastMode {
    pub fn duration(&self) -> f32 {
        match self {
            ToastMode::LongHint => 3.0,
            ToastMode::Hint => 2.0,
            ToastMode::Regular => 1.0
        }
    }
}

impl ToastImage {
    pub fn new(sprite_frame: FRect, sprite_sheet_id: u32, number_of_frames: i32) -> Self {
        Self {
            sprite_frame,
            sprite_sheet_id,
            number_of_frames
        }
    }
    
    pub fn static_image(sprite_frame: FRect, sprite_sheet_id: u32) -> Self {
        Self::new(sprite_frame, sprite_sheet_id, 1)
    }
}

#[repr(C)]
pub struct CToast {
    pub is_valid: bool,
    pub text: *const c_char,
    pub mode: ToastMode,
    pub duration: f32,
    pub image: CToastImage,
}

#[repr(C)]
pub struct CToastImage {
    pub is_valid: bool,
    pub sprite_sheet_id: u32,
    pub texture_frame: FRect
}

impl CToast {
    pub fn no_toast() -> Self {
        Self {
            is_valid: false,
            text: std::ptr::null(),
            mode: ToastMode::Regular,
            image: CToastImage::no_image(),
            duration: 0.0,
        }
    }
}

impl CToastImage {
    fn no_image() -> Self {
        Self {
            is_valid: false,
            sprite_sheet_id: 0,
            texture_frame: FRect::square_from_origin(1.0)
        }
    }
}    

pub trait ToastCRepr {
    fn c_repr(&self) -> CToast;
}

impl ToastCRepr for Option<Toast> {
    fn c_repr(&self) -> CToast {
        if let Some(toast) = self {
            CToast { 
                is_valid: true,
                text: str_to_c_char(&toast.text), 
                mode: toast.mode, 
                image: toast.image.c_repr(),
                duration: toast.mode.duration(),
            }
        } else {
            CToast::no_toast()
        }
    }
}

trait ToastImageCRepr {
    fn c_repr(&self) -> CToastImage;
}

impl ToastImageCRepr for Option<ToastImage> {
    fn c_repr(&self) -> CToastImage {
        if let Some(image) = &self {
            CToastImage {
                is_valid: true,
                sprite_sheet_id: image.sprite_sheet_id,
                texture_frame: image.sprite_frame
            }
        } else {
            CToastImage::no_image()
        }
    }
}