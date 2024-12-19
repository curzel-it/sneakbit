use crate::{constants::{MAX_PLAYERS, PLAYER1_ENTITY_ID, PLAYER1_INDEX, PLAYER2_ENTITY_ID, PLAYER2_INDEX, PLAYER3_ENTITY_ID, PLAYER3_INDEX, PLAYER4_ENTITY_ID, PLAYER4_INDEX}, features::entity_props::EntityProps, input::keyboard_events_provider::KeyboardEventsProvider, utils::directions::Direction, worlds::world::World};

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
    (0..MAX_PLAYERS).map(PlayerProps::new).collect()
}

impl World {
    pub fn index_of_player_at(&self, x: i32, y: i32) -> Option<usize> {
        for p in &self.players {
            if p.props.hittable_frame.x == x && p.props.hittable_frame.y == y {
                return Some(p.index)
            }
        }
        None
    }
    
    pub fn entity_ids_of_all_players_at(&self, x: i32, y: i32) -> Vec<u32> { 
        self.index_of_all_players_at(x, y)
            .into_iter()
            .filter_map(|i| self.player_entity_id_by_index(i)) 
            .collect()
    }

    fn player_entity_id_by_index(&self, index: usize) -> Option<u32> {
        match index {
            PLAYER1_INDEX => Some(PLAYER1_ENTITY_ID),
            PLAYER2_INDEX => Some(PLAYER2_ENTITY_ID),
            PLAYER3_INDEX => Some(PLAYER3_ENTITY_ID),
            PLAYER4_INDEX => Some(PLAYER4_ENTITY_ID),
            _ => None
        }
    }

    fn index_of_all_players_at(&self, x: i32, y: i32) -> Vec<usize> {
        self.players.iter().filter_map(|p| {
            if p.props.hittable_frame.x == x && p.props.hittable_frame.y == y {
                Some(p.index)
            } else {
                None
            }
        })
        .collect()
    }

    pub fn is_any_hero_at(&self, x: i32, y: i32) -> bool {
        for p in &self.players {
            if p.props.hittable_frame.x == x && p.props.hittable_frame.y == y {
                return true
            }
        }
        false
    }
}