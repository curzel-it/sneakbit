use crate::{constants::MAX_PLAYERS, features::entity_props::EntityProps, input::keyboard_events_provider::KeyboardEventsProvider, utils::directions::Direction};

#[derive(Clone, Default, Debug)]
pub struct PlayerProps {
    pub index: usize,
    pub direction_based_on_current_keys: Direction,
    pub is_any_arrow_key_down: bool,
    pub has_ranged_attack_key_been_pressed: bool,
    pub has_close_attack_key_been_pressed: bool,
    pub has_confirmation_key_been_pressed: bool,
    pub props: EntityProps
}

impl PlayerProps {
    fn new(index: usize) -> Self {
        Self {
            index,
            direction_based_on_current_keys: Direction::Unknown,
            is_any_arrow_key_down: false,
            has_ranged_attack_key_been_pressed: false,
            has_close_attack_key_been_pressed: false,
            has_confirmation_key_been_pressed: false,
            props: EntityProps::default()
        }
    }
}

impl PlayerProps {
    pub fn update(&mut self, keyboard: &KeyboardEventsProvider) {
        self.direction_based_on_current_keys = keyboard.direction_based_on_current_keys(self.index, self.props.direction);
        self.is_any_arrow_key_down = keyboard.is_any_arrow_key_down(self.index);
        self.has_ranged_attack_key_been_pressed = keyboard.has_ranged_attack_key_been_pressed(self.index);
        self.has_close_attack_key_been_pressed = keyboard.has_close_attack_key_been_pressed(self.index);
        self.has_confirmation_key_been_pressed = keyboard.has_confirmation_been_pressed(self.index);
    }
}

pub fn empty_props_for_all_players() -> Vec<PlayerProps> {
    (0..MAX_PLAYERS).map(|index| PlayerProps::new(index)).collect()
}