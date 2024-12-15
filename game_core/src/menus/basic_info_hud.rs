use crate::{constants::{MAX_PLAYERS, SPRITE_SHEET_INVENTORY}, entities::{known_species::SPECIES_KUNAI_LAUNCHER, species::species_by_id}, game_engine::{engine::GameTurn, storage::{get_value_for_global_key, inventory_count, StorageKey}}, hstack, player_current_hp, shows_death_screen, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

pub struct BasicInfoHud {
    players: Vec<PlayerHud>
}

impl BasicInfoHud {
    pub fn new() -> Self {
        Self {
            players: (0..MAX_PLAYERS).map(PlayerHud::new).collect()
        }
    }

    pub fn update(&mut self, number_of_players: usize) {
        self.players.iter_mut().take(number_of_players).for_each(|p| p.update());
    }

    pub fn ui(
        &self, 
        turn: &GameTurn,
        number_of_players: usize, 
        dead_players: &[usize]
    ) -> View {
        let include_header = number_of_players > 1;
        let max_hp_to_show = 60.0;
        
        zstack!(
            Spacing::SM,
            COLOR_TRANSPARENT,
            View::VStack { 
                spacing: Spacing::SM, 
                children: self.players
                    .iter()
                    .filter_map(|p| {
                        if dead_players.contains(&p.player) {
                            return None
                        }
                        if p.player >= number_of_players {
                            return None
                        }
                        if match turn {
                            GameTurn::RealTime => true,
                            GameTurn::Player(current_player_index, _) => p.player == *current_player_index,
                        } {
                            Some(p.ui(include_header, max_hp_to_show))
                        } else {
                            None
                        }
                    })
                    .collect()
            }
        )
    }
}

struct PlayerHud {
    player: usize,
    ammo_texture_rect: IntRect,
    ammo_count: u32,
    hp: f32
}

impl PlayerHud {
    fn new(player: usize) -> Self {
        Self { 
            player,
            ammo_texture_rect: IntRect::square_from_origin(1),
            ammo_count: 0,
            hp: 0.0
        }
    }    

    fn update(&mut self) {
        let weapon_id = get_value_for_global_key(&StorageKey::currently_equipped_ranged_weapon(self.player)).unwrap_or(SPECIES_KUNAI_LAUNCHER);
        let weapon = species_by_id(weapon_id);
        let ammo = species_by_id(weapon.bullet_species_id);
        self.ammo_count = inventory_count(&ammo.id, self.player);
        self.ammo_texture_rect = ammo.inventory_sprite_frame();
        self.hp = player_current_hp(self.player);
    }

    fn ui(&self, include_header: bool, max_hp_to_show: f32) -> View {
        if self.hp <= 0.00001 {
            empty_view()
        } else {
            hstack!(
                Spacing::LG,
                self.header_ui(include_header),
                self.ammo_count_ui(),
                self.hp_ui(max_hp_to_show)
            )
        }
    }

    fn header_ui(&self, include_header: bool) -> View {
        if include_header {
            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(Typography::SmallTitle, format!("P{}", self.player + 1))
            )
        } else {
            empty_view()
        }
    }

    fn hp_ui(&self, max_hp_to_show: f32) -> View {
        if self.hp < max_hp_to_show && !shows_death_screen() {
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

    fn ammo_count_ui(&self) -> View {
        hstack!(
            Spacing::Zero,
            texture!(
                SPRITE_SHEET_INVENTORY, 
                self.ammo_texture_rect, 
                Vector2d::new(1.0, 1.0)
            ),
            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(Typography::Regular, format!("x{}", self.ammo_count))
            )                
        )
    }
} 