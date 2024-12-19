use std::os::raw::c_char;

use crate::utils::strings::str_to_c_char;

#[derive(Debug, Clone)]
pub struct DisplayableMessage {
    pub title: String,
    pub text: String
}

impl DisplayableMessage {
    pub fn new(title: String, text: String) -> Self {
        Self { title, text }
    }
}

#[repr(C)]
pub struct CDisplayableMessage {
    pub is_valid: bool,
    pub title: *const c_char,
    pub text: *const c_char,
}

impl CDisplayableMessage {
    pub fn no_message() -> Self {
        Self {
            is_valid: false,
            title: std::ptr::null(),
            text: std::ptr::null()
        }
    }
}

pub trait DisplayableMessageCRepr {
    fn c_repr(&self) -> CDisplayableMessage;
}

impl DisplayableMessageCRepr for Option<DisplayableMessage> {
    fn c_repr(&self) -> CDisplayableMessage {
        if let Some(message) = &self {
            CDisplayableMessage {
                is_valid: true,
                title: str_to_c_char(&message.title),
                text: str_to_c_char(&message.text),
            }
        } else {
            CDisplayableMessage::no_message()
        }
    }
}