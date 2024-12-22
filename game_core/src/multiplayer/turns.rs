use crate::constants::{TURN_DURATION, TURN_DURATION_AFTER_RANGED_WEAPON_USAGE};

#[derive(Clone, Copy)]
pub enum GameTurn {
    RealTime,
    Player(PlayerTurnInfo)
}

#[derive(Clone, Copy)]
pub struct PlayerTurnInfo {
    pub player_index: usize,
    pub time_remaining: f32,
    pub did_reduce_due_to_ranged_weapon_usage: bool
}

impl PlayerTurnInfo {
    pub fn new(player_index: usize) -> Self {
        Self {
            player_index,
            time_remaining: TURN_DURATION,
            did_reduce_due_to_ranged_weapon_usage: false,
        }
    }

    pub fn with_new_time_left(&self, time_remaining: f32) -> Self {
        Self {
            player_index: self.player_index,
            time_remaining,
            did_reduce_due_to_ranged_weapon_usage: self.did_reduce_due_to_ranged_weapon_usage
        }
    }

    pub fn with_reduced_due_to_ranged_weapon_usage(&self) -> Self {
        Self {
            player_index: self.player_index,
            time_remaining: self.time_remaining.min(TURN_DURATION_AFTER_RANGED_WEAPON_USAGE),
            did_reduce_due_to_ranged_weapon_usage: true
        }
    }
}