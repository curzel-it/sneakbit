use crate::{constants::{PLAYER1_INDEX, TURN_DURATION}, features::state_updates::PlayerIndex};

use super::{modes::GameMode, turns::{GameTurn, PlayerTurnInfo}};

pub struct TurnsUseCase {
    // ...
}

pub enum TurnResultAfterPlayerDeath {
    NextTurn(GameTurn),
    InProgress
}

pub enum MatchResult {
    Winner(PlayerIndex),
    UnknownWinner,
    GameOver,
    InProgress
}

impl TurnsUseCase {
    pub fn first_turn(&self, game_mode: GameMode) -> GameTurn {
        match game_mode {
            GameMode::RealTimeCoOp => GameTurn::RealTime,
            GameMode::Creative => GameTurn::RealTime,
            GameMode::TurnBasedPvp => GameTurn::PlayerPrep(PlayerTurnInfo::new_prep(PLAYER1_INDEX)),
        }
    }
    
    pub fn updated_turn(&self, current_turn: &GameTurn, number_of_players: usize, time_since_last_update: f32) -> GameTurn {
        if number_of_players == 1 {
            return *current_turn
        }
        match current_turn {
            GameTurn::RealTime => GameTurn::RealTime,
            GameTurn::PlayerPrep(turn_info) => {
                let new_time_left = turn_info.time_remaining - time_since_last_update;

                if new_time_left <= 0.0 {
                    GameTurn::Player(PlayerTurnInfo::new(turn_info.player_index))
                } else {
                    GameTurn::PlayerPrep(turn_info.with_new_time_left(new_time_left))
                }
            },
            GameTurn::Player(turn_info) => {
                let new_time_left = turn_info.time_remaining - time_since_last_update;

                if new_time_left <= 0.0 {
                    let next_player = if turn_info.player_index == number_of_players - 1 {
                        PLAYER1_INDEX
                    } else { 
                        turn_info.player_index + 1 
                    };                    
                    GameTurn::PlayerPrep(PlayerTurnInfo::new_prep(next_player))
                } else {
                    GameTurn::Player(turn_info.with_new_time_left(new_time_left))
                }
            }
        }
    }

    pub fn update_turn_after_player_damage(&self, current_turn: &GameTurn, damaged_player: &usize) -> GameTurn {
        match current_turn {
            GameTurn::RealTime => GameTurn::RealTime,
            GameTurn::PlayerPrep(turn_info) => GameTurn::PlayerPrep(*turn_info),
            GameTurn::Player(turn_info) => {
                if turn_info.player_index != *damaged_player {
                    GameTurn::Player(turn_info.with_reduced_due_to_enemy_player_damage())
                } else {
                    GameTurn::Player(*turn_info)
                }
            },
        }
    }
    
    pub fn updated_turn_for_death_of_player(&self, current_turn: &GameTurn, number_of_players: usize, dead_player_index: usize) -> TurnResultAfterPlayerDeath {
        match current_turn {
            GameTurn::RealTime => TurnResultAfterPlayerDeath::InProgress,
            GameTurn::PlayerPrep(_) => TurnResultAfterPlayerDeath::InProgress,
            GameTurn::Player(turn_info) => {
                if turn_info.player_index == dead_player_index {
                    let next = self.updated_turn(current_turn, number_of_players, TURN_DURATION * 2.0);
                    TurnResultAfterPlayerDeath::NextTurn(next)
                } else {
                    TurnResultAfterPlayerDeath::InProgress
                }
            },
        }
    }

    pub fn handle_win_lose(&self, game_mode: GameMode, number_of_players: usize, dead_players: &[usize]) -> MatchResult {
        match game_mode {
            GameMode::RealTimeCoOp => {
                if dead_players.contains(&PLAYER1_INDEX) {
                    MatchResult::GameOver
                } else {
                    MatchResult::InProgress
                }
            },
            GameMode::TurnBasedPvp => {
                if dead_players.len() >= number_of_players - 1 {
                    let winner = (0..number_of_players).find(|&i| !dead_players.contains(&i));
                    if let Some(winner) = winner {
                        MatchResult::Winner(winner)
                    } else {
                        MatchResult::UnknownWinner
                    }
                } else {
                    MatchResult::InProgress
                }
            },
            GameMode::Creative => MatchResult::InProgress,
        }
    }
}

#[repr(C)]
pub struct CMatchResult {
    pub winner: usize,
    pub unknown_winner: bool,
    pub game_over: bool,
    pub in_progress: bool
}

impl MatchResult {
    pub fn c_repr(&self) -> CMatchResult {
        CMatchResult {
            winner: match self {
                MatchResult::Winner(index) => *index,
                _ => 0
            },
            unknown_winner: matches!(self, MatchResult::UnknownWinner),
            game_over: matches!(self, MatchResult::GameOver),
            in_progress: matches!(self, MatchResult::InProgress),
        }
    }
}