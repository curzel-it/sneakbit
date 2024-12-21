use game_core::{input::keyboard_events_provider::KeyboardEventsProvider, lang::localizable::LocalizableText, match_result, multiplayer::turns_use_case::MatchResult, revive, text, ui::components::{empty_view, Spacing, Typography, View}, vstack};

use super::context::GameContext;

pub fn update_death_screen(context: &mut GameContext, keyboard: &KeyboardEventsProvider) {
    if context.death_screen.is_open {
        if keyboard.has_confirmation_been_pressed_by_anyone() {
            context.death_screen.is_open = false;
            revive();
        } else {
            context.death_screen.update();
        }
    } else {
        match match_result() {
            MatchResult::Winner(winner_index) => {
                context.death_screen.show_match_winner(*winner_index)
            }
            MatchResult::UnknownWinner => {
                context.death_screen.show_match_unknown_result()
            }
            MatchResult::GameOver => {
                context.death_screen.show_hero_died()
            }
            MatchResult::InProgress => {}
        }
    }
}

pub struct DeathScreen {
    is_open: bool,
    title: String,
    text: String,
}

impl DeathScreen {
    pub fn new() -> Self {
        Self {
            is_open: false,
            title: "death_screen.title".localized(),
            text: "death_screen.subtitle".localized(),
        }
    }

    pub fn is_open(&self) -> bool {
        self.is_open
    }

    fn show_hero_died(&mut self) { 
        self.title = "death_screen.title".localized();
        self.text = "death_screen.subtitle".localized();
        self.is_open = true
    }
    
    fn show_match_winner(&mut self, winner_index: usize) {  
        self.title = "death_screen.player_won"
            .localized()
            .replace("%PLAYER_NAME%", &format!("{}", winner_index + 1));
        self.text = "death_screen.start_new_match".localized();
        self.is_open = true
    }

    fn show_match_unknown_result(&mut self) { 
        self.title = "death_screen.unknown_result".localized();
        self.text = "death_screen.start_new_match".localized();
        self.is_open = true
    }

    fn update(&mut self) {
        // ...
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