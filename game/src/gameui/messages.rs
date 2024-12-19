
use game_core::{input::keyboard_events_provider::{KeyboardEventsProvider}, lang::localizable::LocalizableText, next_message, spacing, text, ui::{components::{empty_view, Spacing, Typography, View, COLOR_MENU_BACKGROUND}, scaffold::scaffold}, utils::strings::wrap_text, vstack};

use crate::GameContext;

use super::menu::{MenuItem, MENU_BORDERS_TEXTURES};

pub fn update_messages(context: &mut GameContext, keyboard: &KeyboardEventsProvider) {
    if context.messages.is_open {
        context.messages.update(keyboard)
    } else if let Some(message) = next_message() {
        context.messages.show(&message.title, &message.text);
    }        
}

pub struct MessagesDisplay {
    pub visible_line_count: usize,
    pub max_line_length: usize,
    title: String,
    text: String,
    is_open: bool,
    scroll_offset: usize,
    uses_backdrop: bool,
    lines: Vec<String>,
}

impl MessagesDisplay {
    pub fn new(max_line_length: usize, visible_line_count: usize) -> Self {
        Self {
            title: "".to_owned(),
            text: "".to_owned(),
            is_open: false,
            visible_line_count,
            scroll_offset: 0,
            uses_backdrop: true,
            max_line_length,
            lines: vec![],
        }
    }

    pub fn is_open(&self) -> bool {
        self.is_open
    }

    pub fn show(&mut self, title: &str, text: &str) {
        self.title = title.to_owned();
        self.text = text.to_owned();
        self.scroll_offset = 0;
        self.lines = wrap_text(&self.text, self.max_line_length);
        self.is_open = true;
    }

    fn close(&mut self) {
        self.is_open = false;
    }

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider) {
        if self.is_open {
            if keyboard.has_back_been_pressed_by_anyone()|| keyboard.has_confirmation_been_pressed_by_anyone() {
                self.close();
            }
            let max_offset = self.lines.len().saturating_sub(self.visible_line_count);

            if keyboard.is_direction_up_pressed_by_anyone() && self.scroll_offset > 0 {
                self.scroll_offset -= 1;
            }
            if keyboard.is_direction_down_pressed_by_anyone() && self.scroll_offset < max_offset {
                self.scroll_offset += 1;
            }
        }
    }

    pub fn ui(&self) -> View {
        if self.is_open {
            scaffold(
                self.uses_backdrop,
                COLOR_MENU_BACKGROUND,
                Some(MENU_BORDERS_TEXTURES),
                self.text_ui()
            )
        } else {
            empty_view()
        }
    }

    fn text_ui(&self) -> View {
        let (start_index, end_index) = if self.visible_line_count < self.lines.len() {
            let start_index = self.scroll_offset.min(self.lines.len().saturating_sub(2)).max(0);
            let end_index = (self.scroll_offset + self.visible_line_count).min(self.lines.len());
            (start_index, end_index)
        } else {
            (0, self.visible_line_count.min(self.lines.len()))
        };

        let visible_lines: Vec<View> = self.lines[start_index..end_index]
            .iter()
            .map(|line| { text!(Typography::Regular, line.clone()) })
            .collect();

        let mut children: Vec<View> = Vec::new();

        if self.title.is_empty() {
            children.push(text!(Typography::Title, ">".to_owned()));
        } else {
            children.push(text!(Typography::Title, self.title.clone()));
        }

        if self.scroll_offset > 0 {
            children.push(text!(Typography::Regular, "^".to_owned()));
        }

        children.extend(visible_lines);

        if self.scroll_offset + self.visible_line_count < self.lines.len() {
            children.push(text!(Typography::Regular, "...".to_owned()));
        } else {
            children.push(spacing!(Spacing::Zero));
            children.push(text!(Typography::Selected, "ok_action".localized()));
        }

        vstack!(
            Spacing::XL,
            View::VStack {
                spacing: Spacing::LG,
                children
            }
        )
    }
}

impl MenuItem for String {
    fn title(&self) -> String {
        self.clone()
    }
}