use crate::{lang::localizable::LocalizableText, text, ui::components::{empty_view, Spacing, Typography, View}, vstack};

pub struct DeathScreen {
    pub is_open: bool
}

impl DeathScreen {
    pub fn new() -> Self {
        Self {
            is_open: false
        }
    }

    pub fn show(&mut self) {
        self.is_open = true
    }

    pub fn ui(&self) -> View {
        if self.is_open {
            vstack!(
                Spacing::LG,
                text!(Typography::Title, "death_screen.title".localized()),
                text!(Typography::Regular, "death_screen.subtitle".localized())
            )
        } else {
            empty_view()
        }
    }
}