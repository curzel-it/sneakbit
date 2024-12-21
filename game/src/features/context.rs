use super::{audio::AudioManager, death_screen::DeathScreen, loading_screen::LoadingScreen};
use crate::gameui::{basic_info_hud::BasicInfoHud, game_menu::GameMenu, messages::MessagesDisplay, toasts::ToastDisplay, weapon_selection::WeaponsGrid};
use raylib::prelude::*;

pub struct GameContext {
    pub rl: RaylibHandle,
    pub rl_thread: RaylibThread,
    pub needs_window_init: bool,
    pub latest_world: u32,
    pub is_fullscreen: bool,
    pub total_run_time: f32,
    pub using_controller: bool,
    pub last_number_of_players: usize,
    pub last_pvp: bool,
    pub audio_manager: AudioManager, 
    pub messages: MessagesDisplay,
    pub weapons_selection: WeaponsGrid,
    pub menu: GameMenu,
    pub basic_info_hud: BasicInfoHud,
    pub toast: ToastDisplay,
    pub death_screen: DeathScreen,
    pub loading_screen: LoadingScreen,
    pub last_sound_track: String,
}

impl GameContext {
    pub fn new(rl: RaylibHandle, rl_thread: RaylibThread) -> Self {
        Self {
            rl,
            rl_thread,
            needs_window_init: true,
            latest_world: 0,
            is_fullscreen: false,
            total_run_time: 0.0,
            using_controller: false,
            last_sound_track: "".to_owned(),
            last_number_of_players: 1,
            last_pvp: false,
            audio_manager: AudioManager::new(),
            messages: MessagesDisplay::new(50, 9),
            weapons_selection: WeaponsGrid::new(),
            menu: GameMenu::new(),
            basic_info_hud: BasicInfoHud::new(),
            toast: ToastDisplay::new(),            
            death_screen: DeathScreen::new(),
            loading_screen: LoadingScreen::new(),
        }
    }

    pub fn is_game_paused(&self) -> bool {
        self.menu.is_open() || self.messages.is_open() || self.is_dead()
    }

    pub fn is_dead(&self) -> bool {
        self.death_screen.is_open()
    }

    pub fn can_render_frame(&self) -> bool {
        !self.loading_screen.is_in_progress() || self.loading_screen.progress() > 0.4
    }
}