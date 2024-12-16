use crate::features::state_updates::PlayerIndex;

#[derive(Clone, Copy)]
pub enum GameTurn {
    RealTime,
    Player(PlayerIndex, f32)
}