use crate::{constants::{MAX_PLAYERS, SPRITE_SHEET_INVENTORY}, hstack, number_of_cannonball_in_inventory, number_of_kunai_in_inventory, number_of_rem223_in_inventory, player_current_hp, shows_death_screen, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

pub struct BasicInfoHud {
    players: Vec<PlayerHud>
}

impl BasicInfoHud {
    pub fn new() -> Self {
        Self {
            players: (0..MAX_PLAYERS).map(|index| PlayerHud::new(index)).collect()
        }
    }

    pub fn update(&mut self, number_of_players: usize) {
        self.players.iter_mut().take(number_of_players).for_each(|p| p.update());
    }

    pub fn ui(&self, number_of_players: usize) -> View {
        let include_header = number_of_players > 1;
        
        zstack!(
            Spacing::MD,
            COLOR_TRANSPARENT,
            View::VStack { 
                spacing: Spacing::SM, 
                children: self.players
                    .iter()
                    .take(number_of_players)
                    .map(|p| p.ui(include_header))
                    .collect()
            }
        )
    }
}

struct PlayerHud {
    player: usize,
    number_of_kunais: i32,
    number_of_cannonball: i32,
    number_of_rem223: i32,
    hp: f32
}

impl PlayerHud {
    fn new(player: usize) -> Self {
        Self { 
            player,
            number_of_kunais: 0,
            number_of_cannonball: 0,
            number_of_rem223: 0,
            hp: 0.0
        }
    }    

    fn update(&mut self) {
        self.number_of_kunais = 99; //number_of_kunai_in_inventory(self.player);
        self.number_of_cannonball = 99; //number_of_cannonball_in_inventory(self.player);
        self.number_of_rem223 = 99; //number_of_rem223_in_inventory(self.player);
        self.hp = match self.player {
            1 => 50.0,
            2 => 20.0,
        _ => 100.0
        }; //player_current_hp(self.player);
    }

    fn ui(&self, include_header: bool) -> View {
        hstack!(
            Spacing::LG,
            hstack!(
                Spacing::Zero,
                self.header_ui(include_header),
                self.ammo_count_ui(self.number_of_kunais, 7, 1),
                self.ammo_count_ui(self.number_of_rem223, 11, 6),
                self.ammo_count_ui(self.number_of_cannonball, 11, 7)
            ),
            self.hp_ui()
        )
    }

    fn header_ui(&self, include_header: bool) -> View {
        if include_header {
            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(Typography::SmallTitle, format!("P{}", self.player))
            )
        } else {
            empty_view()
        }
    }

    fn hp_ui(&self) -> View {
        if self.hp < 60.0 && !shows_death_screen() {
            let typography = if self.hp < 30.0 { Typography::Selected } else { Typography::Regular };
            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(typography, format!("HP {:0.1}%", self.hp))
            )
        } else {
            empty_view()
        }
    }

    fn ammo_count_ui(&self, count: i32, sprite_y: i32, sprite_x: i32) -> View {
        hstack!(
            Spacing::Zero,
            texture!(
                SPRITE_SHEET_INVENTORY, 
                IntRect::new(sprite_x, sprite_y, 1, 1), 
                Vector2d::new(1.0, 1.0)
            ),
            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(Typography::Regular, format!("{}", count))
            )                
        )
    }
} 