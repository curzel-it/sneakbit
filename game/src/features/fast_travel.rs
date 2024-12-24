use game_core::{cancel_fast_travel, did_request_fast_travel, entities::fast_travel::{available_fast_travel_destinations_from_current_world, FastTravelDestination}, handle_fast_travel, input::keyboard_events_provider::KeyboardEventsProvider, lang::localizable::LocalizableText, ui::components::View};
use crate::gameui::menu::Menu;
use super::context::GameContext;

pub fn update_fast_travel(context: &mut GameContext, keyboard: &KeyboardEventsProvider) {
    if context.fast_travel_menu.is_open() {
        context.fast_travel_menu.update(keyboard);
    } else if did_request_fast_travel() {
        context.fast_travel_menu.open();
    }
}

pub struct FastTravelMenu {
    menu: Menu<String>,    
    destinations: Vec<FastTravelDestination>
}

impl FastTravelMenu {
    pub fn new() -> Self {
        let mut menu = Menu::new(
            "fast_travel.menu.title".localized(), 
            vec![]
        );
        menu.text = Some("fast_travel.menu.text".localized());
        Self { menu, destinations: vec![] }
    }

    pub fn is_open(&self) -> bool {
        self.menu.is_open
    }

    pub fn ui(&self) -> View {
        self.menu.ui()
    }

    fn close(&mut self) {
        cancel_fast_travel();
        self.menu.clear_confirmation();
        self.menu.clear_selection();
        self.menu.close();
    }

    fn open(&mut self) {
        self.destinations = available_fast_travel_destinations_from_current_world();                
        if self.destinations.len() <= 1 {
            return
        }
        let mut items: Vec<String> = self.destinations
            .iter()
            .map(|destination| {
                format!("location.name.{}", destination.world_id()).localized()
            })
            .collect();
        items.push("menu_back".localized());
        self.menu.items = items;
        self.menu.show()
    }

    fn update(&mut self, keyboard: &KeyboardEventsProvider) {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.close();
        } else {
            self.menu.update(keyboard);

            if self.menu.selection_has_been_confirmed {
                let index = self.menu.selected_index;
                if index != self.destinations.len() {
                    handle_fast_travel(self.destinations[index].clone())
                }
                self.close();
            }
        }
    }
}
