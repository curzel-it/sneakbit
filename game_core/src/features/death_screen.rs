use crate::{lang::localizable::LocalizableText, text, ui::components::{empty_view, Spacing, Typography, View}, vstack};

pub struct DeathScreen {
    pub is_open: bool,
    pub title: String,
    pub text: String,
}

impl DeathScreen {
    pub fn new() -> Self {
        Self {
            is_open: false,
            title: "death_screen.title".localized(),
            text: "death_screen.subtitle".localized(),
        }
    }

    pub fn show_hero_died(&mut self) { 
        self.title = "death_screen.title".localized();
        self.text = "death_screen.subtitle".localized();
        self.is_open = true
    }
    
    pub fn show_match_winner(&mut self, winner_index: usize) {  
        self.title = "death_screen.player_won"
            .localized()
            .replace("%PLAYER_NAME%", &format!("{}", winner_index + 1));
        self.text = "death_screen.start_new_match".localized();
        self.is_open = true
    }

    pub fn show_match_unknown_result(&mut self) { 
        self.title = "death_screen.unknown_result".localized();
        self.text = "death_screen.start_new_match".localized();
        self.is_open = true
    }

    pub fn ui(&self) -> View {
        if self.is_open {
            vstack!(
                Spacing::LG,
                text!(Typography::Title, self.title.clone()),
                text!(Typography::Regular, self.text.clone())
            )
        } else {
            empty_view()
        }
    }
}