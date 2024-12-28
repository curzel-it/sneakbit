use crate::{constants::PLAYER1_INDEX, multiplayer::{modes::GameMode, player_props::PlayerProps, turns::GameTurn}};

pub fn camera_center(
    game_mode: GameMode, 
    turn: &GameTurn, 
    number_of_players: usize, 
    players: &[PlayerProps], 
    dead_players: &[usize]
) -> (f32, f32) {
    let current_player_index = match turn {
        GameTurn::RealTime => PLAYER1_INDEX,
        GameTurn::PlayerPrep(turn_info) => turn_info.player_index,
        GameTurn::Player(turn_info) => turn_info.player_index,
    };

    if (number_of_players - dead_players.len()) <= 1 || game_mode.is_turn_based() {
        let p = players[current_player_index].props;
        (p.hittable_frame.x, p.hittable_frame.y)
    } else {
        let sum: (f32, f32) = players
            .iter()
            .filter_map(|p| {
                if dead_players.contains(&p.index) {
                    return None
                }
                if p.index >= number_of_players {
                    return None
                }
                let x = p.props.hittable_frame.x as f32;
                let y = p.props.hittable_frame.y as f32;
                Some((x, y))
            })
            .fold((0.0, 0.0), |acc, (x, y)| {
                (acc.0 + x, acc.1 + y)
            });

        let x = sum.0 / number_of_players as f32;                
        let y = sum.1 / number_of_players as f32;
        (x, y)
    }
}