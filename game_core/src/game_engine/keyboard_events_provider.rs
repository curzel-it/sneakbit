use lazy_static::lazy_static;

use crate::{constants::{KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS, KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST, MAX_PLAYERS}, utils::directions::Direction};

lazy_static! {
    pub static ref NO_KEYBOARD_EVENTS: KeyboardEventsProvider = KeyboardEventsProvider::new();
}

pub struct KeyboardEventsProvider {
    players: Vec<PlayerKeyboardEventsProvider>
}

impl KeyboardEventsProvider {
    pub fn new() -> Self {
        Self {
            players: vec![
                PlayerKeyboardEventsProvider::new(),
                PlayerKeyboardEventsProvider::new(),
                PlayerKeyboardEventsProvider::new(),
                PlayerKeyboardEventsProvider::new()
            ]
        }
    }
}

impl KeyboardEventsProvider {
    pub fn has_ranged_attack_key_been_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.has_ranged_attack_key_been_pressed {
                return true
            }
        }
        false
    }

    pub fn index_of_any_player_who_is_pressing_confirm(&self) -> Option<usize> {
        for index in 0..MAX_PLAYERS {
            if self.players[index].has_confirmation_been_pressed {
                return Some(index)
            }
        }
        None
    }

    pub fn has_confirmation_been_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.has_confirmation_been_pressed {
                return true
            }
        }
        false
    }

    pub fn is_any_arrow_key_down_for_anyone(&self) -> bool {
        for player in &self.players {
            if player.is_any_arrow_key_down() {
                return true
            }
        }
        false
    }

    pub fn has_close_attack_key_been_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.has_close_attack_key_been_pressed {
                return true
            }
        }
        false
    }

    pub fn has_back_been_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.has_back_been_pressed {
                return true
            }
        }
        false
    }

    pub fn has_back_been_pressed(&self, player: usize) -> bool {
        self.players[player].has_back_been_pressed
    }

    pub fn has_menu_been_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.has_menu_been_pressed {
                return true
            }
        }
        false
    }

    pub fn is_direction_up_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.direction_up.is_pressed {
                return true
            }
        }
        false
    }

    pub fn is_direction_right_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.direction_right.is_pressed {
                return true
            }
        }
        false
    }

    pub fn is_direction_down_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.direction_down.is_pressed {
                return true
            }
        }
        false
    }

    pub fn is_direction_left_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.direction_left.is_pressed {
                return true
            }
        }
        false
    }

    pub fn is_direction_up_pressed(&self, player: usize) -> bool {
        self.players[player].direction_up.is_pressed
    }

    pub fn is_direction_right_pressed(&self, player: usize) -> bool {
        self.players[player].direction_right.is_pressed
    }

    pub fn is_direction_down_pressed(&self, player: usize) -> bool {
        self.players[player].direction_down.is_pressed
    }

    pub fn is_direction_left_pressed(&self, player: usize) -> bool {
        self.players[player].direction_left.is_pressed
    }

    pub fn is_direction_up_down(&self, player: usize) -> bool {
        self.players[player].direction_up.is_down
    }

    pub fn is_direction_right_down(&self, player: usize) -> bool {
        self.players[player].direction_right.is_down
    }

    pub fn is_direction_down_down(&self, player: usize) -> bool {
        self.players[player].direction_down.is_down
    }

    pub fn is_direction_left_down(&self, player: usize) -> bool {
        self.players[player].direction_left.is_down
    }

    pub fn currently_pressed_character(&self) -> Option<char> {
        self.players[0].currently_pressed_character
    }

    pub fn has_backspace_been_pressed(&self) -> bool {
        self.players[0].has_backspace_been_pressed
    }

    pub fn on_world_changed(&mut self) {
        for player in &mut self.players {
            player.on_world_changed();
        }
    }

    pub fn direction_based_on_current_keys(&self, player: usize, current: Direction) -> Direction {
        self.players[player].direction_based_on_current_keys(current)
    }

    pub fn is_any_arrow_key_down(&self, player: usize) -> bool  {
        self.players[player].is_any_arrow_key_down()
    }
    
    pub fn has_any_arrow_key_been_pressed(&self, player: usize) -> bool {
        self.players[player].has_any_arrow_key_been_pressed()
    }
    
    pub fn has_ranged_attack_key_been_pressed(&self, player: usize) -> bool {
        self.players[player].has_ranged_attack_key_been_pressed
    }
    
    pub fn has_close_attack_key_been_pressed(&self, player: usize) -> bool {
        self.players[player].has_close_attack_key_been_pressed
    }
    
    pub fn has_confirmation_been_pressed(&self, player: usize) -> bool {
        self.players[player].has_confirmation_been_pressed
    }
    
    pub fn has_weapon_selection_been_pressed(&self, player: usize) -> bool {
        self.players[player].has_weapon_selection_been_pressed
    }
    
    pub fn has_weapon_selection_been_pressed_by_anyone(&self) -> bool {
        for player in &self.players {
            if player.has_weapon_selection_been_pressed {
                return true
            }
        }
        false
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        player: usize,
        up_pressed: bool,
        right_pressed: bool,
        down_pressed: bool,
        left_pressed: bool,
        up_down: bool,
        right_down: bool,
        down_down: bool,
        left_down: bool,
        escape_pressed: bool,
        menu_pressed: bool,
        confirm_pressed: bool,
        close_attack_pressed: bool,
        ranged_attack_pressed: bool,
        weapon_selection_pressed: bool,
        backspace_pressed: bool,
        current_char: Option<char>,
        time_since_last_update: f32
    ) {
        self.players[player].update(
            up_pressed,
            right_pressed,
            down_pressed,
            left_pressed,
            up_down,
            right_down,
            down_down,
            left_down,
            escape_pressed,
            menu_pressed,
            confirm_pressed,
            close_attack_pressed,
            ranged_attack_pressed,
            weapon_selection_pressed,
            backspace_pressed,
            current_char,
            time_since_last_update
        )
    }
}

struct PlayerKeyboardEventsProvider {
    has_back_been_pressed: bool,
    has_menu_been_pressed: bool,
    has_confirmation_been_pressed: bool,
    has_close_attack_key_been_pressed: bool,
    has_ranged_attack_key_been_pressed: bool,
    has_weapon_selection_been_pressed: bool,
    has_backspace_been_pressed: bool,

    direction_up: HoldableKey,
    direction_right: HoldableKey,
    direction_down: HoldableKey,
    direction_left: HoldableKey,

    discard_direction_events_until_next_arrow_key_is_pressed: bool,
    currently_pressed_character: Option<char>,
}

impl PlayerKeyboardEventsProvider {
    const fn new() -> Self {
        Self {
            has_back_been_pressed: false,
            has_menu_been_pressed: false,
            has_close_attack_key_been_pressed: false,
            has_ranged_attack_key_been_pressed: false,
            has_confirmation_been_pressed: false,
            has_weapon_selection_been_pressed: false,
            has_backspace_been_pressed: false,
            direction_up: HoldableKey::new(),
            direction_right: HoldableKey::new(),
            direction_down: HoldableKey::new(),
            direction_left: HoldableKey::new(),
            discard_direction_events_until_next_arrow_key_is_pressed: false,
            currently_pressed_character: None,
        }
    }

    fn on_world_changed(&mut self) {
        self.discard_direction_events_until_next_arrow_key_is_pressed = true;
    }

    fn direction_based_on_current_keys(&self, current: Direction) -> Direction {
        if self.discard_direction_events_until_next_arrow_key_is_pressed {
            return Direction::Unknown;
        }

        let direction_from_new_keys = Direction::from_data(
            self.direction_up.is_down,
            self.direction_right.is_down,
            self.direction_down.is_down,
            self.direction_left.is_down,
        );
        match direction_from_new_keys {
            Direction::Unknown => current,
            Direction::Still => Direction::Unknown,
            _ => direction_from_new_keys
        }
    }

    fn is_any_arrow_key_down(&self) -> bool {
        self.direction_up.is_down
            || self.direction_right.is_down
            || self.direction_down.is_down
            || self.direction_left.is_down
    }

    fn has_any_arrow_key_been_pressed(&self) -> bool {
        self.direction_up.is_pressed
            || self.direction_right.is_pressed
            || self.direction_down.is_pressed
            || self.direction_left.is_pressed
    }
}

struct HoldableKey {
    time_to_next_press_event: f32,
    is_down: bool,
    is_pressed: bool,
}

impl HoldableKey {
    const fn new() -> Self {
        Self {
            time_to_next_press_event: 0.0,
            is_down: false,
            is_pressed: false,
        }
    }

    fn update(&mut self, is_pressed: bool, is_down: bool, time_since_last_update: f32) {
        self.is_down = is_down;
        self.is_pressed = is_pressed;

        if self.is_pressed {
            self.time_to_next_press_event = KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST;
        } else if self.is_down {
            self.time_to_next_press_event -= time_since_last_update;

            if self.time_to_next_press_event <= 0.0 {
                self.is_pressed = true;
                self.time_to_next_press_event = KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS;
            }
        }
    }
}

impl PlayerKeyboardEventsProvider {
    #[allow(clippy::too_many_arguments)]
    fn update(
        &mut self,
        up_pressed: bool,
        right_pressed: bool,
        down_pressed: bool,
        left_pressed: bool,
        up_down: bool,
        right_down: bool,
        down_down: bool,
        left_down: bool,
        escape_pressed: bool,
        menu_pressed: bool,
        confirm_pressed: bool,
        close_attack_pressed: bool,
        ranged_attack_pressed: bool,
        weapon_selection_pressed: bool,
        backspace_pressed: bool,
        current_char: Option<char>,
        time_since_last_update: f32
    ) {
        self.discard_direction_events_until_next_arrow_key_is_pressed = 
        self.discard_direction_events_until_next_arrow_key_is_pressed &&
            !up_pressed &&
            !right_pressed &&
            !down_pressed &&
            !left_pressed;
    
        self.has_back_been_pressed = escape_pressed;
        self.has_menu_been_pressed = menu_pressed;
        self.has_confirmation_been_pressed = confirm_pressed;
        self.has_close_attack_key_been_pressed = close_attack_pressed;
        self.has_ranged_attack_key_been_pressed = ranged_attack_pressed;
        self.has_weapon_selection_been_pressed = weapon_selection_pressed;
        self.has_backspace_been_pressed = backspace_pressed;
    
        self.direction_up.update(up_pressed, up_down, time_since_last_update);
        self.direction_right.update(right_pressed, right_down, time_since_last_update);
        self.direction_down.update(down_pressed, down_down, time_since_last_update);
        self.direction_left.update(left_pressed, left_down, time_since_last_update);
    
        self.currently_pressed_character = current_char;
    }
}