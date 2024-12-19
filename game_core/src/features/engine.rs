use crate::{constants::{INITIAL_CAMERA_VIEWPORT, SPRITE_SHEET_ANIMATED_OBJECTS, TILE_SIZE, WORLD_ID_NONE}, features::{destination::Destination, loading_screen::LoadingScreen, sound_effects::SoundEffectsManager}, input::{keyboard_events_provider::KeyboardEventsProvider, mouse_events_provider::MouseEventsProvider}, is_creative_mode, lang::localizable::LocalizableText, features::toasts::{Toast, ToastImage, ToastMode}, multiplayer::{modes::GameMode, turns::GameTurn, turns_use_case::{MatchResult, TurnResultAfterPlayerDeath, TurnsUseCase}}, utils::{directions::Direction, rect::IntRect, vector::Vector2d}, worlds::world::World};

use super::{camera::camera_center, messages::DisplayableMessage, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{decrease_inventory_count, get_value_for_global_key, increment_inventory_count, reset_all_stored_values, set_value_for_key, StorageKey}};

pub struct GameEngine {
    pub world: World,
    pub previous_world: Option<World>,
    pub loading_screen: LoadingScreen,
    pub keyboard: KeyboardEventsProvider,
    pub mouse: MouseEventsProvider,
    pub camera_viewport: IntRect,
    pub camera_viewport_offset: Vector2d,
    pub is_running: bool,
    pub wants_fullscreen: bool,
    pub sound_effects: SoundEffectsManager,
    pub number_of_players: usize,
    pub game_mode: GameMode,
    pub dead_players: Vec<usize>,
    pub turn: GameTurn,
    turns_use_case: TurnsUseCase,
    pub message: Option<DisplayableMessage>,
    pub toast: Option<Toast>,
    pub match_result: MatchResult,
    did_just_revive: bool
}

impl GameEngine {
    pub fn new(game_mode: GameMode) -> Self {
        Self {
            world: World::load_or_create(WORLD_ID_NONE),
            previous_world: None,
            loading_screen: LoadingScreen::new(),
            keyboard: KeyboardEventsProvider::new(),
            mouse: MouseEventsProvider::new(),
            camera_viewport: INITIAL_CAMERA_VIEWPORT,
            camera_viewport_offset: Vector2d::zero(),
            is_running: true,
            wants_fullscreen: false,
            sound_effects: SoundEffectsManager::new(),
            number_of_players: 1,
            game_mode,
            dead_players: vec![],
            turn: GameTurn::RealTime,
            turns_use_case: TurnsUseCase {},
            message: None,
            toast: None,
            match_result: MatchResult::InProgress,
            did_just_revive: false
        }
    }

    pub fn start(&mut self) {
        self.run_migrations();
        self.teleport_to_previous();
    }

    pub fn update(&mut self, time_since_last_update: f32) {     
        self.clear_messages();

        self.loading_screen.update(time_since_last_update);
        if self.loading_screen.progress() < 0.4 { 
            self.sound_effects.clear();
        }

        self.update_current_turn(time_since_last_update);

        let updates = self.world.update(time_since_last_update, &self.camera_viewport, &self.keyboard);
        
        if self.did_just_revive {
            self.did_just_revive = false;
            self.sound_effects.handle_resurrection();
        } else {
            self.sound_effects.update(&self.keyboard, &updates);
        }
        self.center_camera_onto_players();
        self.apply_state_updates(updates);
    } 

    fn teleport_to_previous(&mut self) {
        let world_id = get_value_for_global_key(&StorageKey::latest_world()).unwrap_or(1001);
        let destination = Destination::new(world_id, self.world.spawn_point.0, self.world.spawn_point.1);
        self.teleport(&destination);
    }

    pub fn window_size_changed(&mut self, width: f32, height: f32, scale: f32) {
        self.camera_viewport.w = (width / (scale * TILE_SIZE)) as i32;
        self.camera_viewport.h = (height / (scale * TILE_SIZE)) as i32;
    }
    
    fn clear_messages(&mut self) {
        self.message = None;
        self.toast = None;
        self.match_result = MatchResult::InProgress;
    }

    fn apply_state_updates(&mut self, updates: Vec<EngineStateUpdate>) {
        let mut sorted_updates = updates.clone();

        sorted_updates.sort_by(|a, b| {
            use EngineStateUpdate::*;
            
            match (a, b) {
                (Teleport(_), Teleport(_)) => std::cmp::Ordering::Equal,
                (Teleport(_), _) => std::cmp::Ordering::Greater,
                (_, Teleport(_)) => std::cmp::Ordering::Less,
                _ => std::cmp::Ordering::Equal,
            }
        });
        
        sorted_updates.iter().for_each(|u| {
            self.apply_state_update(u)
        });
    }

    fn center_camera_onto_players(&mut self) {
        let (x, y, offset) = camera_center(
            self.game_mode,
            &self.turn,
            self.number_of_players,
            &self.world.players,
            &self.dead_players
        );
        self.center_camera_at(x, y, &offset);
    }
    
    pub fn apply_world_state_updates(&mut self, world_updates: Vec<WorldStateUpdate>) {
        let updates = self.world.apply_state_updates(world_updates);
        self.apply_state_updates(updates);
    }

    fn apply_state_update(&mut self, update: &EngineStateUpdate) {   
        update.log();

        match update {
            EngineStateUpdate::Teleport(destination) => {
                self.teleport(destination)
            }
            EngineStateUpdate::AddToInventory(player, species_id, _) => {
                increment_inventory_count(*species_id, *player);
            }
            EngineStateUpdate::RemoveFromInventory(player, species_id) => {
                decrease_inventory_count(species_id, *player);
            }
            EngineStateUpdate::Toast(toast) => {
                self.toast = Some(toast.clone());
            }
            EngineStateUpdate::Message(message) => {
                self.message = Some(message.clone());
            }
            EngineStateUpdate::PlayerDied(player_index) => {
                self.dead_players.push(*player_index);
                self.update_current_turn_for_death_of_player(*player_index);
                self.handle_win_lose()
            }
            _ => {}
        }
    }

    pub fn save(&self) {
        if is_creative_mode() {
            set_value_for_key(&StorageKey::latest_world(), self.world.id);     
            self.world.save();
        }
    }

    fn teleport(&mut self, destination: &Destination) {
        self.dead_players.clear();
        self.loading_screen.animate_world_transition();

        if is_creative_mode() {
            self.world.save();
        }
            
        if self.world.id != WORLD_ID_NONE {
            set_value_for_key(&StorageKey::previous_world(), self.world.id);
        }
        
        let mut new_world = self.world_by_id(destination.world);
        new_world.setup(
            self.previous_world(), 
            &self.world.players[0].props.direction, 
            destination.x, 
            destination.y,
            destination.direction
        );
        new_world.update_no_input(0.001);
        new_world.update_no_input(0.001);
        new_world.update_no_input(0.001);

        let hero_frame = new_world.players[0].props.frame;
        if !self.world.ephemeral_state {
            self.previous_world = Some(self.world.clone());
        }
        self.world = new_world;
        self.world.spawn_point = (hero_frame.x, hero_frame.y);
        self.center_camera_at(hero_frame.x, hero_frame.y, &Vector2d::zero());

        self.keyboard.on_world_changed();
        self.mouse.on_world_changed();

        set_value_for_key(&StorageKey::latest_world(), self.world.id);
    }
    
    fn world_by_id(&self, destination_world: u32) -> World {
        if let Some(previous) = self.previous_world.clone() {
            if previous.id == destination_world {
                println!("Reusing previous world");
                return previous
            }
        }
        World::load_or_create(destination_world)
    }

    fn previous_world(&self) -> u32 {
        if self.world.id == WORLD_ID_NONE { 
            get_value_for_global_key(&StorageKey::previous_world()).unwrap_or(WORLD_ID_NONE)
        } else {
            self.world.id
        }
    }

    fn center_camera_at(&mut self, x: i32, y: i32, offset: &Vector2d) {
        self.camera_viewport.center_at(&Vector2d::new(x as f32, y as f32));
        self.camera_viewport_offset = *offset;
    }

    pub fn start_new_game(&mut self) {
        self.clear_messages();
        self.previous_world = None;
        self.world.players[0].props.direction = Direction::Unknown;        
        reset_all_stored_values();
        self.world = World::load(1000).unwrap();
        self.teleport_to_previous();
        reset_all_stored_values();
    }

    pub fn update_game_mode(&mut self, game_mode: GameMode) {
        self.game_mode = game_mode;
        self.turn = self.turns_use_case.first_turn(game_mode);
        self.update_number_of_players(self.number_of_players);
    }

    pub fn update_number_of_players(&mut self, count: usize) {
        self.dead_players.clear();
        self.number_of_players = count;
        self.teleport_to_previous();
    }
    
    pub fn update_current_turn(&mut self, time_since_last_update: f32) {
        self.turn = self.turns_use_case.updated_turn(&self.turn, self.number_of_players, time_since_last_update);
    }
    
    pub fn update_current_turn_for_death_of_player(&mut self, dead_player_index: usize) {
        if let GameTurn::Player(current_player_index, _) = self.turn {
            if current_player_index == dead_player_index {
                self.toast = Some(
                    Toast::new_with_image(
                        ToastMode::LongHint,
                        "notification.player.died"
                            .localized()
                            .replace("%PLAYER_NAME%", &format!("{}", dead_player_index + 1)),
                        ToastImage::new(
                            IntRect::new(9, 17, 1, 1), 
                            SPRITE_SHEET_ANIMATED_OBJECTS, 
                            4
                        )
                    )
                );
            }
        }
        if let TurnResultAfterPlayerDeath::NextTurn(next) = self.turns_use_case.updated_turn_for_death_of_player(&self.turn, self.number_of_players, dead_player_index) {
            self.turn = next;
        }
    }

    fn handle_win_lose(&mut self) {
        self.match_result = self.turns_use_case.handle_win_lose(
            self.game_mode, 
            self.number_of_players, 
            &self.dead_players
        );
    }

    pub fn revive(&mut self) {
        self.match_result = MatchResult::InProgress;
        self.dead_players.clear();
        self.previous_world = None;
        self.world.players[0].props.direction = Direction::Unknown;
        self.teleport_to_previous();
        self.did_just_revive = true;
    }
}