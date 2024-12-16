#[derive(Clone, Copy)]
#[repr(C)]
pub enum GameMode {
    RealTimeCoOp = 0,
    Creative = 1,
    TurnBasedPvp = 2
}

impl GameMode {
    pub fn allows_pvp(&self) -> bool {
        matches!(self, GameMode::TurnBasedPvp)
    }

    pub fn is_turn_based(&self) -> bool {
        matches!(self, GameMode::TurnBasedPvp)   
    }
}
