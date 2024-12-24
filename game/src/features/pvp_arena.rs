use game_core::{cancel_pvp_arena_request, constants::MAX_PLAYERS, did_request_pvp_arena, handle_pvp_arena, input::keyboard_events_provider::KeyboardEventsProvider, lang::localizable::LocalizableText, ui::components::View};
use crate::gameui::menu::Menu;
use super::context::GameContext;

pub fn update_pvp_arena(context: &mut GameContext, keyboard: &KeyboardEventsProvider) {
    if context.pvp_arena_menu.is_open() {
        context.pvp_arena_menu.update(keyboard);
    } else if did_request_pvp_arena() {
        context.pvp_arena_menu.open();
    }
}

pub struct PvpArenaMenu {
    menu: Menu<String>,
}

impl PvpArenaMenu {
    pub fn new() -> Self {
        let mut menu = Menu::new(
            "pvp_arena.menu.title".localized(), 
            vec![]
        );
        menu.text = Some("pvp_arena.menu.text".localized());
        Self { menu }
    }

    pub fn is_open(&self) -> bool {
        self.menu.is_open
    }

    pub fn ui(&self) -> View {
        self.menu.ui()
    }

    fn close(&mut self) {
        cancel_pvp_arena_request();
        self.menu.clear_confirmation();
        self.menu.clear_selection();
        self.menu.close();
    }

    fn open(&mut self) {
        self.menu.items = player_options();
        self.menu.show()
    }

    fn update(&mut self, keyboard: &KeyboardEventsProvider) {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.close();
        } else {
            self.menu.update(keyboard);

            if self.menu.selection_has_been_confirmed {
                let index = self.menu.selected_index;

                if index == self.menu.items.len() - 1 {
                    self.menu.clear_selection();
                    self.menu.close();
                } else {
                    handle_pvp_arena(index + 2);
                }
                self.close();
            }
        }
    }
}

fn player_options() -> Vec<String> {
    let mut options: Vec<String> = (2..=MAX_PLAYERS)
        .map(|n| format!("game.menu.number_of_players.{}", n).localized())
        .collect();
    options.push("menu_back".localized());
    options
}