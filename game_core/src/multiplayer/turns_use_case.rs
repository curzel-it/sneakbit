use crate::{constants::{PLAYER1_INDEX, TURN_DURATION}, features::state_updates::PlayerIndex};

use super::{modes::GameMode, turns::GameTurn};

pub struct TurnsUseCase {
    // ...
}

pub enum TurnResultAfterPlayerDeath {
    NextTurn(GameTurn),
    NothingChanged
}

pub enum MatchResult {
    Winner(PlayerIndex),
    UnknownWinner,
    GameOver,
    NothingChanged
}

impl TurnsUseCase {
    pub fn first_turn(&self, game_mode: GameMode) -> GameTurn {
        match game_mode {
            GameMode::RealTimeCoOp => GameTurn::RealTime,
            GameMode::Creative => GameTurn::RealTime,
            GameMode::TurnBasedPvp => GameTurn::Player(PLAYER1_INDEX, TURN_DURATION),
        }
    }
    
    pub fn updated_turn(&self, current_turn: &GameTurn, number_of_players: usize, time_since_last_update: f32) -> GameTurn {
        if number_of_players == 1 {
            return current_turn.clone()
        }
        match current_turn {
            GameTurn::RealTime => GameTurn::RealTime,
            GameTurn::Player(current_player_index, time_left) => {
                let new_time_left = time_left - time_since_last_update;

                if new_time_left <= 0.0 {
                    let next_player = if *current_player_index == number_of_players - 1 {
                        PLAYER1_INDEX
                    } else { 
                        current_player_index + 1 
                    };                    
                    GameTurn::Player(next_player, TURN_DURATION)
                } else {
                    GameTurn::Player(*current_player_index, new_time_left)
                }
            }
        }
    }
    
    pub fn updated_turn_for_death_of_player(&self, current_turn: &GameTurn, number_of_players: usize, dead_player_index: usize) -> TurnResultAfterPlayerDeath {
        match current_turn {
            GameTurn::RealTime => TurnResultAfterPlayerDeath::NothingChanged,
            GameTurn::Player(current_player_index, _) => {
                if *current_player_index == dead_player_index {
                    let next = self.updated_turn(current_turn, number_of_players, TURN_DURATION * 2.0);
                    TurnResultAfterPlayerDeath::NextTurn(next)
                } else {
                    TurnResultAfterPlayerDeath::NothingChanged
                }
            },
        }
    }

    pub fn handle_win_lose(&self, game_mode: GameMode, number_of_players: usize, dead_players: &Vec<usize>) -> MatchResult {
        match game_mode {
            GameMode::RealTimeCoOp => {
                if dead_players.contains(&PLAYER1_INDEX) {
                    MatchResult::GameOver
                } else {
                    MatchResult::NothingChanged
                }
            },
            GameMode::TurnBasedPvp => {
                if dead_players.len() == number_of_players - 1 {
                    let winner = (0..number_of_players).find(|&i| !dead_players.contains(&i));
                    if let Some(winner) = winner {
                        MatchResult::Winner(winner)
                    } else {
                        MatchResult::UnknownWinner
                    }
                } else {
                    MatchResult::NothingChanged
                }
            },
            GameMode::Creative => MatchResult::NothingChanged,
        }
    }
}