use crate::{constants::{KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS, KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST}, utils::directions::Direction};

pub const NO_KEYBOARD_EVENTS: KeyboardEventsProvider = KeyboardEventsProvider::new();

pub struct KeyboardEventsProvider {
    pub has_back_been_pressed: bool,
    pub has_menu_been_pressed: bool,
    pub has_confirmation_been_pressed: bool,
    pub has_attack_key_been_pressed: bool,
    pub has_backspace_been_pressed: bool,

    pub direction_up: HoldableKey,
    pub direction_right: HoldableKey,
    pub direction_down: HoldableKey,
    pub direction_left: HoldableKey,

    pub discard_direction_events_until_next_arrow_key_is_pressed: bool,
    pub currently_pressed_character: Option<char>,
}

impl KeyboardEventsProvider {
    pub const fn new() -> Self {
        Self {
            has_back_been_pressed: false,
            has_menu_been_pressed: false,
            has_attack_key_been_pressed: false,
            has_confirmation_been_pressed: false,
            has_backspace_been_pressed: false,
            direction_up: HoldableKey::new(),
            direction_right: HoldableKey::new(),
            direction_down: HoldableKey::new(),
            direction_left: HoldableKey::new(),
            discard_direction_events_until_next_arrow_key_is_pressed: false,
            currently_pressed_character: None,
        }
    }

    pub fn on_world_changed(&mut self) {
        self.discard_direction_events_until_next_arrow_key_is_pressed = true;
    }

    pub fn direction_based_on_current_keys(&self, current: Direction) -> Direction {
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

    pub fn is_any_arrow_key_down(&self) -> bool {
        self.direction_up.is_down
            || self.direction_right.is_down
            || self.direction_down.is_down
            || self.direction_left.is_down
    }

    pub fn has_any_arrow_key_been_pressed(&self) -> bool {
        self.direction_up.is_pressed
            || self.direction_right.is_pressed
            || self.direction_down.is_pressed
            || self.direction_left.is_pressed
    }
}

pub struct HoldableKey {
    time_to_next_press_event: f32,
    pub is_down: bool,
    pub is_pressed: bool,
}

impl HoldableKey {
    const fn new() -> Self {
        Self {
            time_to_next_press_event: 0.0,
            is_down: false,
            is_pressed: false,
        }
    }

    pub fn update(&mut self, is_pressed: bool, is_down: bool, time_since_last_update: f32) {
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

impl KeyboardEventsProvider {
    #[allow(clippy::too_many_arguments)]
    pub fn update(
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
        attack_pressed: bool,
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
        self.has_attack_key_been_pressed = attack_pressed;
        self.has_backspace_been_pressed = backspace_pressed;
    
        self.direction_up.update(up_pressed, up_down, time_since_last_update);
        self.direction_right.update(right_pressed, right_down, time_since_last_update);
        self.direction_down.update(down_pressed, down_down, time_since_last_update);
        self.direction_left.update(left_pressed, left_down, time_since_last_update);
    
        self.currently_pressed_character = current_char;
    }
}