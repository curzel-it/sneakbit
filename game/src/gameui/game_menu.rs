use game_core::{constants::{MAX_PLAYERS, PVP_AVAILABLE, WORLD_ID_NONE}, current_game_mode, engine, features::{sound_effects::{are_sound_effects_enabled, is_music_enabled, toggle_music, toggle_sound_effects}, state_updates::{visit, EngineStateUpdate, WorldStateUpdate}, storage::{set_value_for_key, StorageKey}}, input::{keyboard_events_provider::KeyboardEventsProvider, mouse_events_provider::MouseEventsProvider}, is_creative_mode, is_game_running, lang::localizable::LocalizableText, multiplayer::modes::GameMode, number_of_players, spacing, start_new_game, stop_game, toggle_pvp, ui::components::{Spacing, View}, update_number_of_players, utils::rect::IntRect};

use super::{confirmation::{ConfirmationDialog, ConfirmationOption}, map_editor::MapEditor, menu::{Menu, MenuItem, MenuUpdate}};

pub struct GameMenu {
    pub current_world_id: u32,
    state: MenuState,
    pub menu: Menu<GameMenuItem>,
    settings_menu: Menu<GameSettingsItem>,
    map_editor: MapEditor,
    new_game_confirmation: ConfirmationDialog,
    credits_menu: Menu<String>,
    languages_menu: Menu<String>,
    number_of_players_menu: Menu<String>,
}

#[derive(Debug)]
enum MenuState {
    Closed,
    Open,
    MapEditor,
    PlaceItem,
    NewGameConfirmation,
    ShowingLanguageSettings,
    ShowingCredits,
    SelectingNumberOfPlayers,
    ShowingSettings, 
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameMenuItem {
    Resume,
    ToggleFullScreen,
    NewGame,
    Save,
    MapEditor,
    Exit,
    GameSettings, 
    NumberOfPlayers,
    Controls,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameSettingsItem {
    ToggleSoundEffects,
    ToggleMusic,
    LanguageSettings,
    Credits, 
    Back,
}

impl MenuItem for GameMenuItem {
    fn title(&self) -> String {
        match self {
            GameMenuItem::Resume => "game.menu.resume".localized(),
            GameMenuItem::Save => "game.menu.save".localized(),
            GameMenuItem::NewGame => "game.menu.new_game".localized(),
            GameMenuItem::MapEditor => "game.menu.map_editor".localized(),
            GameMenuItem::Exit => "game.menu.exit".localized(),
            GameMenuItem::ToggleFullScreen => "game.menu.toggle_fullscreen".localized(),
            GameMenuItem::NumberOfPlayers => "game.menu.number_of_players".localized(),
            GameMenuItem::Controls => "game.menu.controls".localized(),
            GameMenuItem::GameSettings => "game.menu.settings".localized(),
        }
    }
}

impl MenuItem for GameSettingsItem {
    fn title(&self) -> String {
        match self {
            GameSettingsItem::ToggleSoundEffects => {
                if are_sound_effects_enabled() {
                    "game.menu.disable_sound_effects".localized()
                } else {
                    "game.menu.enable_sound_effects".localized()
                }
            }
            GameSettingsItem::ToggleMusic => {
                if is_music_enabled() {
                    "game.menu.disable_music".localized()
                } else {
                    "game.menu.enable_music".localized()
                }
            }
            GameSettingsItem::LanguageSettings => "game.menu.language".localized(),
            GameSettingsItem::Credits => "credits".localized(),
            GameSettingsItem::Back => "menu_back".localized(),
        }
    }
}

impl GameMenu {
    pub fn new() -> Self {
        let menu = Menu::new(
            "game.menu.title".localized(),
            vec![
                GameMenuItem::Resume,
                GameMenuItem::ToggleFullScreen,
                GameMenuItem::NewGame,
                GameMenuItem::Save,
                GameMenuItem::MapEditor,
                GameMenuItem::GameSettings, 
                GameMenuItem::NumberOfPlayers,
                GameMenuItem::Controls,
                GameMenuItem::Exit,
            ],
        );

        let settings_menu = Menu::new(
            "game.menu.settings".localized(),
            vec![
                GameSettingsItem::ToggleSoundEffects,
                GameSettingsItem::ToggleMusic,
                GameSettingsItem::LanguageSettings,
                GameSettingsItem::Credits, 
                GameSettingsItem::Back, 
            ],
        );

        let credits_menu = Menu::new(
            "credits".localized(),
            vec![
                "credits.developer".localized(),
                "credits.open_source".localized(),
                "credits.music".localized(),
                "credits.sound_effects".localized(),
                "menu_back".localized(),
            ],
        );

        let languages_menu = Menu::new(
            "game.menu.language".localized(),
            vec![
                "game.menu.language.system".localized(),
                "game.menu.language.en".localized(),
                "game.menu.language.it".localized(),
                "menu_back".localized(),
            ],
        );

        let mut number_of_players_menu = Menu::new(
            "game.menu.number_of_players".localized(),
            vec![],
        );
        number_of_players_menu.text = Some("game.menu.number_of_players.subtitle".localized());

        Self {
            current_world_id: WORLD_ID_NONE,
            state: MenuState::Closed,
            menu,
            settings_menu,
            map_editor: MapEditor::new(),
            new_game_confirmation: ConfirmationDialog::new(),
            credits_menu,
            languages_menu,
            number_of_players_menu,
        }
    }

    pub fn setup(&mut self, world_id: u32) {
        self.current_world_id = world_id;
        self.menu.title = "game.menu.title".localized();
        self.settings_menu.title = "game.menu.settings".localized();
        self.languages_menu.title = "game.menu.language".localized();
        self.credits_menu.title = "credits".localized();
        self.number_of_players_menu.title = "game.menu.number_of_players".localized();
        self.number_of_players_menu.items = player_options();

        self.menu.items = if is_creative_mode() {
            vec![
                GameMenuItem::Save,
                GameMenuItem::Resume,
                GameMenuItem::ToggleFullScreen,
                GameMenuItem::MapEditor,
                GameMenuItem::GameSettings, 
                GameMenuItem::Exit,
            ]
        } else {
            vec![
                GameMenuItem::Resume,
                GameMenuItem::ToggleFullScreen,
                GameMenuItem::NewGame,
                GameMenuItem::GameSettings,
                GameMenuItem::NumberOfPlayers,
                GameMenuItem::Controls,
                GameMenuItem::Exit,
            ]
        }
    }

    pub fn is_open(&self) -> bool {
        !matches!(self.state, MenuState::Closed)
    }

    pub fn show(&mut self) {
        self.state = MenuState::Open;
        self.menu.show();
    }

    pub fn close(&mut self) {
        self.menu.clear_selection();
        self.menu.close();
        self.settings_menu.clear_selection();
        self.settings_menu.close();
        self.credits_menu.clear_selection();
        self.credits_menu.close();
        self.languages_menu.clear_selection();
        self.languages_menu.close();
        self.number_of_players_menu.clear_selection();
        self.number_of_players_menu.close();
        self.state = MenuState::Closed;
    }

    pub fn update(
        &mut self,
        camera_vieport: &IntRect,
        keyboard: &KeyboardEventsProvider,
        mouse: &MouseEventsProvider
    ) -> MenuUpdate {
        if self.is_open() && self.menu.selection_has_been_confirmed {
            let updates = self.handle_selection();
            return (self.menu.is_open, updates);
        }

        let updates = match self.state {
            MenuState::Closed => vec![],
            MenuState::Open => self.update_from_open(keyboard),
            MenuState::MapEditor => {
                self.update_from_map_editor(camera_vieport, keyboard, mouse)
            }
            MenuState::PlaceItem => self.update_from_place_item(camera_vieport, keyboard, mouse),
            MenuState::NewGameConfirmation => {
                self.update_from_new_game(keyboard)
            }
            MenuState::ShowingLanguageSettings => {
                self.update_from_language(keyboard)
            }
            MenuState::ShowingCredits => self.update_from_credits(keyboard),
            MenuState::SelectingNumberOfPlayers => {
                self.update_from_number_of_players(keyboard)
            }
            MenuState::ShowingSettings => self.update_from_settings(keyboard),
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
                engine().save();
                vec![]
            }
            GameMenuItem::MapEditor => {
                self.state = MenuState::MapEditor;
                self.map_editor.current_world_id = self.current_world_id;
                vec![]
            }
            GameMenuItem::GameSettings => {
                self.settings_menu.show();
                self.state = MenuState::ShowingSettings;
                vec![]
            }
            GameMenuItem::NumberOfPlayers => {
                self.number_of_players_menu.show();
                self.state = MenuState::SelectingNumberOfPlayers;
                vec![]
            }
            GameMenuItem::NewGame => {
                self.new_game_confirmation.show(
                    &"game.menu.new_game".localized(),
                    &"game.menu.new_game_are_you_sure".localized()
                );
                self.state = MenuState::NewGameConfirmation;
                vec![]
            }
            GameMenuItem::Controls => {
                self.close();
                vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::DisplayLongText(
                    "game.menu.controls".localized(),
                    "game.menu.controls.explained".localized(),
                ))]
            }
            GameMenuItem::Exit => {
                println!("Got exit request!");
                self.close();
                stop_game();
                vec![]
            }
        }
    }

    fn update_from_credits(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        let (mut is_open, mut updates) = self.credits_menu.update(keyboard);

        if self.credits_menu.selection_has_been_confirmed {
            match self.credits_menu.selected_index {
                0 => updates.push(visit(&"credits.developer.link".localized())),
                1 => updates.push(visit(&"credits.open_source.link".localized())),
                2 => updates.push(visit(&"credits.music.link".localized())),
                3 => updates.push(visit(&"credits.sound_effects.link".localized())),
                _ => {}
            }
            is_open = false;
        }
        if !is_open {
            self.credits_menu.clear_selection();
            self.credits_menu.close();
            self.state = MenuState::ShowingSettings; 
        }
        updates
    }

    fn update_from_new_game(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.state = MenuState::Open;
            return vec![];
        }
        if let Some(new_game_confirm) = self.new_game_confirmation.update(keyboard) {
            self.new_game_confirmation.menu.clear_selection();
            self.new_game_confirmation.menu.clear_confirmation();
            self.menu.clear_selection();

            if matches!(new_game_confirm, ConfirmationOption::YesConfirm) { 
                start_new_game();
                self.menu.close();
                self.state = MenuState::Closed;
            } else {
                self.state = MenuState::Open;
            }
            return vec![]
        }
        vec![]
    }

    fn update_from_number_of_players(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.state = MenuState::Open;
            return vec![];
        }
        self.number_of_players_menu.update(keyboard);

        if self.number_of_players_menu.selection_has_been_confirmed {
            let index = self.number_of_players_menu.selected_index;

            if index == 0 && PVP_AVAILABLE {
                toggle_pvp()
            } else if index == self.number_of_players_menu.items.len() - 1 {
                self.number_of_players_menu.clear_selection();
                self.number_of_players_menu.close();
                self.menu.clear_selection();
                self.state = MenuState::Open;
            } else if PVP_AVAILABLE {
                update_number_of_players(self.number_of_players_menu.selected_index)
            } else {
                update_number_of_players(self.number_of_players_menu.selected_index + 1)
            }
            self.number_of_players_menu.clear_confirmation();
            self.number_of_players_menu.items = player_options();
        }
        vec![]
    }

    fn update_from_language(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.state = MenuState::Open;
            return vec![];
        }
        self.languages_menu.update(keyboard);

        if self.languages_menu.selection_has_been_confirmed {
            set_value_for_key(&StorageKey::language(), self.languages_menu.selected_index as u32);
            self.languages_menu.clear_selection();
            self.languages_menu.close();
            self.menu.clear_selection();
            self.menu.close();
            self.setup(self.current_world_id);
            self.state = MenuState::Closed;
        }
        vec![]
    }

    fn update_from_open(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        let (is_open, updates) = self.menu.update(keyboard);

        if !is_open {
            self.menu.clear_selection();
            self.menu.close();
            self.state = MenuState::Closed;
        }
        updates
    }

    fn update_from_map_editor(
        &mut self,
        camera_vieport: &IntRect,
        keyboard: &KeyboardEventsProvider,
        mouse: &MouseEventsProvider,
    ) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.state = MenuState::Open;
        }
        self.map_editor.update(camera_vieport, keyboard, mouse);

        if self.map_editor.is_placing_item() {
            self.state = MenuState::PlaceItem;
        }
        vec![]
    }

    fn update_from_place_item(
        &mut self,
        camera_vieport: &IntRect,
        keyboard: &KeyboardEventsProvider,
        mouse: &MouseEventsProvider,
    ) -> Vec<WorldStateUpdate> {
        if keyboard.has_back_been_pressed_by_anyone() {
            self.state = MenuState::MapEditor;
        }
        self.map_editor.update(camera_vieport, keyboard, mouse)
    }

    fn update_from_settings(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        let (is_open, updates) = self.settings_menu.update(keyboard);

        if self.settings_menu.selection_has_been_confirmed {
            let selected_item = self.settings_menu.selected_item();
            self.settings_menu.clear_confirmation();

            match selected_item {
                GameSettingsItem::ToggleSoundEffects => {
                    toggle_sound_effects();
                }
                GameSettingsItem::ToggleMusic => {
                    toggle_music();
                }
                GameSettingsItem::LanguageSettings => {
                    self.languages_menu.show();
                    self.state = MenuState::ShowingLanguageSettings;
                }
                GameSettingsItem::Credits => {
                    self.credits_menu.show();
                    self.state = MenuState::ShowingCredits;
                }
                GameSettingsItem::Back => {
                    self.settings_menu.close();
                    self.state = MenuState::Open;
                }
            }
        }

        if !is_open {
            self.settings_menu.clear_selection();
            self.settings_menu.close();
            self.state = MenuState::Open;
        }

        updates
    }

    pub fn ui(&self, camera_viewport: &IntRect) -> View {
        match self.state {
            MenuState::Closed => spacing!(Spacing::Zero),
            MenuState::Open => self.menu.ui(),
            MenuState::ShowingCredits => self.credits_menu.ui(),
            MenuState::NewGameConfirmation => self.new_game_confirmation.ui(),
            MenuState::ShowingLanguageSettings => self.languages_menu.ui(),
            MenuState::MapEditor | MenuState::PlaceItem => self.map_editor.ui(camera_viewport),
            MenuState::SelectingNumberOfPlayers => self.number_of_players_menu.ui(),
            MenuState::ShowingSettings => self.settings_menu.ui(), 
        }
    }

    pub fn select_option_at_index(&mut self, index: usize) {
        self.menu.selected_index = index;
    }
}

fn player_options() -> Vec<String> {
    let pvp = if matches!(current_game_mode(), GameMode::TurnBasedPvp) {
        "game.menu.disable_pvp"
    } else {
        "game.menu.enable_pvp"
    };
    let number_of_players = number_of_players();

    let mut options: Vec<String> = (1..=MAX_PLAYERS)
        .map(|n| {
            let selected = if number_of_players == n { ".selected" } else { "" };
            format!("game.menu.number_of_players.{}{}", n, selected).localized()
        })
        .collect();

    if PVP_AVAILABLE {
        options.insert(0, pvp.localized());
    }
    options.push("menu_back".localized());
    options
}