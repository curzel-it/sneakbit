use crate::{constants::{INITIAL_CAMERA_VIEWPORT, TILE_SIZE, WORLD_ID_NONE}, features::{death_screen::DeathScreen, destination::Destination, links::{LinksHandler, NoLinksHandler}, loading_screen::LoadingScreen, sound_effects::SoundEffectsManager}, is_creative_mode, menus::{basic_info_hud::BasicInfoHud, confirmation::ConfirmationDialog, game_menu::GameMenu, long_text_display::LongTextDisplay, toasts::{Toast, ToastDisplay}, weapon_selection::WeaponsGrid}, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

use super::{keyboard_events_provider::{KeyboardEventsProvider, NO_KEYBOARD_EVENTS}, mouse_events_provider::MouseEventsProvider, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{decrease_inventory_count, get_value_for_global_key, increment_inventory_count, reset_all_stored_values, set_value_for_key, StorageKey}, world::World};

pub struct GameEngine {
    pub menu: GameMenu,
    pub world: World,
    pub previous_world: Option<World>,
    pub weapons_selection: WeaponsGrid,
    pub loading_screen: LoadingScreen,
    pub long_text_display: LongTextDisplay,
    pub confirmation_dialog: ConfirmationDialog,
    pub death_screen: DeathScreen,
    pub toast: ToastDisplay,
    pub basic_info_hud: BasicInfoHud,
    pub keyboard: KeyboardEventsProvider,
    pub mouse: MouseEventsProvider,
    pub camera_viewport: IntRect,
    pub camera_viewport_offset: Vector2d,
    pub is_running: bool,
    pub wants_fullscreen: bool,
    pub sound_effects: SoundEffectsManager,
    pub links_handler: Box<dyn LinksHandler>,
    pub number_of_players: usize
}

impl GameEngine {
    pub fn new() -> Self {
        Self {
            menu: GameMenu::new(),
            world: World::load_or_create(WORLD_ID_NONE),
            previous_world: None,
            loading_screen: LoadingScreen::new(),
            long_text_display: LongTextDisplay::new(50, 9),
            confirmation_dialog: ConfirmationDialog::new(),
            death_screen: DeathScreen::new(),
            toast: ToastDisplay::new(),
            keyboard: KeyboardEventsProvider::new(),
            mouse: MouseEventsProvider::new(),
            camera_viewport: INITIAL_CAMERA_VIEWPORT,
            camera_viewport_offset: Vector2d::zero(),
            is_running: true,
            basic_info_hud: BasicInfoHud::new(),
            wants_fullscreen: false,
            sound_effects: SoundEffectsManager::new(),
            links_handler: Box::new(NoLinksHandler::new()),
            number_of_players: 1,
            weapons_selection: WeaponsGrid::new()
        }
    }

    pub fn start(&mut self) {
        self.run_migrations();
        self.menu.setup();
        self.teleport_to_previous();
    }

    pub fn update(&mut self, time_since_last_update: f32) {     
        let mut did_resurrect = false;   
        self.toast.update(time_since_last_update);

        if self.death_screen.is_open {
            if self.keyboard.has_confirmation_been_pressed_by_anyone() {
                self.death_screen.is_open = false;
                self.previous_world = None;
                self.world.players[0].props.direction = Direction::Unknown;
                self.teleport_to_previous();
                did_resurrect = true;
            } else {
                self.sound_effects.clear();
                return;
            }
        }

        self.loading_screen.update(time_since_last_update);
        if self.loading_screen.progress() < 0.4 { 
            self.sound_effects.clear();

            if did_resurrect {
                self.sound_effects.handle_resurrection();
            }
            return;
        }

        let camera_viewport = self.camera_viewport;
        let is_game_paused = self.update_menus(time_since_last_update);

        if !is_game_paused {
            let updates = self.world.update(time_since_last_update, &camera_viewport, &self.keyboard);
            self.sound_effects.update(&self.keyboard, &updates);
            self.apply_state_updates(updates);
            self.center_camera_onto_players();
        };

    } 

    fn update_menus(&mut self, time_since_last_update: f32) -> bool {
        let mut is_game_paused = false;

        self.basic_info_hud.update(self.number_of_players);

        if !is_game_paused {            
            let keyboard = if self.weapons_selection.is_open_or_needs_be(&self.keyboard) { &self.keyboard } else { &NO_KEYBOARD_EVENTS };
            let is_picking_weapon = self.weapons_selection.update(keyboard, time_since_last_update);
            is_game_paused = is_game_paused || is_picking_weapon;
        }

        if !is_game_paused {
            let keyboard = if self.long_text_display.is_open { &self.keyboard } else { &NO_KEYBOARD_EVENTS };
            let is_reading = self.long_text_display.update(keyboard, time_since_last_update);
            is_game_paused = is_game_paused || is_reading;
        }

        if !is_game_paused {
            let keyboard = if self.confirmation_dialog.is_open() { &self.keyboard } else { &NO_KEYBOARD_EVENTS };
            let (pause, world_updates) = self.confirmation_dialog.update(keyboard, time_since_last_update);
            is_game_paused = is_game_paused || pause;
            
            if !world_updates.is_empty() {
                let engine_updates = self.world.apply_state_updates(world_updates);
                self.apply_state_updates(engine_updates);
                self.world.update(0.01, &self.camera_viewport, &NO_KEYBOARD_EVENTS);
            }
        }

        if !is_game_paused {
            let can_handle = self.menu.is_open() || self.keyboard.has_menu_been_pressed_by_anyone();
            let keyboard = if can_handle { &self.keyboard } else { &NO_KEYBOARD_EVENTS };
            let (pause, world_updates) = self.menu.update(&self.camera_viewport, keyboard, &self.mouse, time_since_last_update);
            is_game_paused = is_game_paused || pause;

            if !world_updates.is_empty() {
                let engine_updates = self.world.apply_state_updates(world_updates);
                self.apply_state_updates(engine_updates);
                self.world.update(0.01, &self.camera_viewport, &NO_KEYBOARD_EVENTS);
            }
        }
        
        is_game_paused
    }

    fn teleport_to_previous(&mut self) {
        let world_id = get_value_for_global_key(&StorageKey::latest_world()).unwrap_or(1001);
        let destination = Destination::new(world_id, self.world.spawn_point.0, self.world.spawn_point.1);
        self.teleport(&destination);
    }

    pub fn window_size_changed(
        &mut self, 
        width: f32, 
        height: f32, 
        scale: f32, 
        font_size: f32, 
        line_spacing: f32
    ) {
        self.camera_viewport.w = (width / (scale * TILE_SIZE)) as i32;
        self.camera_viewport.h = (height / (scale * TILE_SIZE)) as i32;
        self.long_text_display.max_line_length = (width / font_size).floor() as usize;
        self.long_text_display.visible_line_count = (0.4 * height / (line_spacing + font_size)).floor() as usize;
        self.menu.menu.visible_item_count = self.long_text_display.visible_line_count - 3;
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
        
        sorted_updates.iter().for_each(|u| self.apply_state_update(u));
    }

    fn center_camera_onto_players(&mut self) {
        if self.number_of_players == 1 {
            let p1 = self.world.players[0].props;
            self.center_camera_at(p1.hittable_frame.x, p1.hittable_frame.y, &p1.offset);
        } else {
            let sum: (f32, f32) = self.world.players
                .iter()
                .take(self.number_of_players)
                .map(|p| {
                    let x = p.props.hittable_frame.x as f32;
                    let y = p.props.hittable_frame.y as f32;
                    let ox = p.props.offset.x / TILE_SIZE;
                    let oy = p.props.offset.y / TILE_SIZE;
                    (x + ox, y + oy)
                })
                .fold((0.0, 0.0), |acc, (x, y)| {
                    (acc.0 + x, acc.1 + y)
                });

            let x = sum.0 / self.number_of_players as f32;                
            let y = sum.1 / self.number_of_players as f32;
            let fx = x.floor();
            let fy = y.floor();

            self.center_camera_at(
                fx as i32, 
                fy as i32, 
                &Vector2d::new(
                    (x - fx) * TILE_SIZE, 
                    (y - fy) * TILE_SIZE
                )
            );
        }
    }

    fn log_update(&self, update: &EngineStateUpdate) {
        println!("Engine update: {:#?}", update)
    }

    fn apply_state_update(&mut self, update: &EngineStateUpdate) {   
        self.log_update(update);

        match update {
            EngineStateUpdate::Teleport(destination) => {
                self.teleport(destination)
            }
            EngineStateUpdate::SaveGame => {
                self.save()
            }
            EngineStateUpdate::Exit => {
                self.exit()
            }
            EngineStateUpdate::AddToInventory(player, species_id, _) => {
                increment_inventory_count(*species_id, *player)
            }
            EngineStateUpdate::RemoveFromInventory(player, species_id) => {
                decrease_inventory_count(species_id, *player);
            }
            EngineStateUpdate::ResumeGame => {
                self.menu.close()
            }
            EngineStateUpdate::Toast(toast) => {
                self.show_toast(toast)
            }
            EngineStateUpdate::Confirmation(title, text, on_confirm) => {
                self.ask_for_confirmation(title, text, on_confirm)
            }
            EngineStateUpdate::DisplayLongText(title, text) => {
                self.long_text_display.show(title, text)
            }
            EngineStateUpdate::DeathScreen => {
                self.death_screen.show()
            }
            EngineStateUpdate::ToggleFullScreen => {
                self.wants_fullscreen = !self.wants_fullscreen
            }
            EngineStateUpdate::NewGame => {
                self.start_new_game()
            }
            EngineStateUpdate::ExternalLink(link) => {
                self.links_handler.open(link);
            }
            _ => {}
        }
    }
    
    fn ask_for_confirmation(&mut self, title: &str, text: &str, on_confirm: &[WorldStateUpdate]) {
        self.confirmation_dialog.show(title, text, on_confirm)
    }

    fn show_toast(&mut self, toast: &Toast) {
        self.toast.show(toast);
    }

    fn exit(&mut self) {
        println!("Got exit request!");
        self.is_running = false;
    }

    fn save(&self) {
        if is_creative_mode() {
            set_value_for_key(&StorageKey::latest_world(), self.world.id);     
            self.world.save();
        }
    }

    fn teleport(&mut self, destination: &Destination) {
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

        self.menu.current_world_id = self.world.id;
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

    pub fn select_current_menu_option_at_index(&mut self, index: usize) {
        if self.confirmation_dialog.is_open() {
            self.confirmation_dialog.select_option_at_index(index);
            return
        }
        if self.menu.is_open() {
            self.menu.select_option_at_index(index);
            return
        }
    }

    pub fn start_new_game(&mut self) {
        self.death_screen.is_open = false;
        self.previous_world = None;
        self.world.players[0].props.direction = Direction::Unknown;        
        reset_all_stored_values();
        self.world = World::load(1000).unwrap();
        self.teleport_to_previous();
        reset_all_stored_values();
    }

    pub fn update_number_of_players(&mut self, count: usize) {
        if count == self.number_of_players { return }
        self.number_of_players = count;
        self.teleport_to_previous();
    }
}

#[cfg(test)]
mod tests {    
    use super::GameEngine;

    #[test]
    fn can_launch_game_headless() {
        let mut engine = GameEngine::new();
        engine.start();
        assert_ne!(engine.world.bounds.w, 10);
        assert_ne!(engine.world.bounds.h, 10);
    }
}