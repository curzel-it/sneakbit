use crate::{constants::WORLD_ID_NONE, game_engine::{keyboard_events_provider::KeyboardEventsProvider, mouse_events_provider::MouseEventsProvider, state_updates::{EngineStateUpdate, WorldStateUpdate}}, lang::localizable::LocalizableText, spacing, ui::components::{Spacing, View}, utils::rect::IntRect};

use super::{confirmation::ConfirmationDialog, map_editor::MapEditor, menu::{Menu, MenuItem, MenuUpdate}};

pub struct GameMenu {
    pub current_world_id: u32,
    state: MenuState,
    pub menu: Menu<GameMenuItem>,
    map_editor: MapEditor,
    new_game_confirmation: ConfirmationDialog
}

#[derive(Debug)]
enum MenuState {
    Closed,
    Open,
    MapEditor,
    PlaceItem,
    NewGameConfirmation,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum GameMenuItem {
    Resume,
    ToggleFullScreen,
    NewGame,
    Save,
    MapEditor,
    Exit,
    SaveAndExit,
}

impl MenuItem for GameMenuItem {
    fn title(&self) -> String {
        match self {
            GameMenuItem::Resume => "game.menu.resume".localized(),
            GameMenuItem::ToggleFullScreen => "game.menu.toggle_fullscreen".localized(),
            GameMenuItem::Save => "game.menu.save".localized(),
            GameMenuItem::NewGame => "game.menu.new_game".localized(),
            GameMenuItem::MapEditor => "game.menu.map_editor".localized(),
            GameMenuItem::Exit => "game.menu.exit".localized(),
            GameMenuItem::SaveAndExit => "game.menu.save_and_exit".localized(),
        }
    }
}

impl GameMenu {
    pub fn new() -> Self {
        let menu = Menu::new(
            "game.menu.title".localized(), 
            vec![
                GameMenuItem::Exit,
            ]
        );

        Self {
            current_world_id: WORLD_ID_NONE,
            state: MenuState::Closed,
            menu,
            map_editor: MapEditor::new(),
            new_game_confirmation: ConfirmationDialog::new()
        }
    }

    pub fn set_creative_mode(&mut self, creative_mode: bool) {
        self.menu.items = if creative_mode {
            vec![
                GameMenuItem::Save,
                GameMenuItem::Resume,
                GameMenuItem::ToggleFullScreen,
                GameMenuItem::MapEditor,
                GameMenuItem::SaveAndExit,
            ]
        } else {
            vec![
                GameMenuItem::Resume,
                GameMenuItem::ToggleFullScreen,
                GameMenuItem::NewGame,
                GameMenuItem::Exit,
            ]
        }
    }

    pub fn is_open(&self) -> bool {
        !matches!(self.state, MenuState::Closed)
    }

    pub fn close(&mut self) {
        self.menu.clear_selection();
        self.menu.close();
        self.state = MenuState::Closed;
    }

    pub fn update(
        &mut self, 
        camera_vieport: &IntRect, 
        keyboard: &KeyboardEventsProvider, 
        mouse: &MouseEventsProvider,
        time_since_last_update: f32
    ) -> MenuUpdate {
        if self.is_open() && self.menu.selection_has_been_confirmed {
            let updates = self.handle_selection();
            return (self.menu.is_open, updates)
        }

        let updates = match self.state {
            MenuState::Closed => self.update_from_close(keyboard),
            MenuState::Open => self.update_from_open(keyboard, time_since_last_update),
            MenuState::MapEditor => self.update_from_map_editor(camera_vieport, keyboard, mouse),
            MenuState::PlaceItem => self.update_from_place_item(camera_vieport, keyboard, mouse),
            MenuState::NewGameConfirmation => self.update_from_new_game(keyboard, time_since_last_update)
        };
        (self.is_open(), updates)
    }

    fn handle_selection(&mut self) -> Vec<WorldStateUpdate> {
        let selected = self.menu.selected_item();
        self.menu.clear_selection();

        match selected {
            GameMenuItem::Resume => {
                self.close();
                vec![]
            }
            GameMenuItem::ToggleFullScreen => {
                self.close();
                vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::ToggleFullScreen)]
            }
            GameMenuItem::Save => {
                self.close();
                vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)]
            }
            GameMenuItem::MapEditor => {
                self.state = MenuState::MapEditor;
                self.map_editor.current_world_id = self.current_world_id;
                vec![]
            }
            GameMenuItem::SaveAndExit => {
                self.close();
                vec![
                    WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame),
                    WorldStateUpdate::EngineUpdate(EngineStateUpdate::Exit),
                ]
            }
            GameMenuItem::NewGame => {
                self.new_game_confirmation.show(                
                    &"game.menu.new_game".localized(),
                    &"game.menu.new_game_are_you_sure".localized(),
                    &[
                        WorldStateUpdate::EngineUpdate(EngineStateUpdate::NewGame),
                        WorldStateUpdate::EngineUpdate(EngineStateUpdate::ResumeGame)
                    ]
                );
                self.state = MenuState::NewGameConfirmation;
                vec![]
            }
            GameMenuItem::Exit => {
                self.close();
                vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::Exit)]
            }
        }
    }

    fn update_from_new_game(&mut self, keyboard: &KeyboardEventsProvider, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed {
            self.state = MenuState::Open;
            return vec![];
        }
        let (is_open, updates) = self.new_game_confirmation.update(keyboard, time_since_last_update);

        if !is_open {
            self.state = MenuState::Open;
        }
        updates
    }

    fn update_from_close(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_menu_been_pressed {
            self.state = MenuState::Open;
            self.menu.show(); 
        }
        vec![]
    }

    fn update_from_open(&mut self, keyboard: &KeyboardEventsProvider, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let (is_open, updates) = self.menu.update(keyboard, time_since_last_update);
        
        if !is_open {
            self.menu.clear_selection();
            self.menu.close();
            self.state = MenuState::Closed;
            return updates
        }
        updates
    }

    fn update_from_map_editor(&mut self, camera_vieport: &IntRect, keyboard: &KeyboardEventsProvider, mouse: &MouseEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed {
            self.state = MenuState::Open;
        }
        self.map_editor.update(camera_vieport, keyboard, mouse);

        if self.map_editor.is_placing_item() {
            self.state = MenuState::PlaceItem;
        }
        vec![]
    }

    fn update_from_place_item(&mut self, camera_vieport: &IntRect, keyboard: &KeyboardEventsProvider, mouse: &MouseEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed {
            self.state = MenuState::MapEditor;
        }
        self.map_editor.update(camera_vieport, keyboard, mouse)
    }

    pub fn ui(&self, camera_viewport: &IntRect) -> View {
        match self.state {
            MenuState::Closed => spacing!(Spacing::Zero),
            MenuState::Open => self.menu.ui(),
            MenuState::NewGameConfirmation => self.new_game_confirmation.ui(),
            MenuState::MapEditor | MenuState::PlaceItem => self.map_editor.ui(camera_viewport),
        }
    }

    pub fn select_option_at_index(&mut self, index: usize) {
        self.menu.selected_index = index;
    }
}
