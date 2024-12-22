use game_core::{constants::{MAX_PLAYERS, SPRITE_SHEET_INVENTORY}, currently_active_players, entities::{known_species::SPECIES_KUNAI_LAUNCHER, species::species_by_id}, features::storage::{get_value_for_global_key, inventory_count, StorageKey}, hstack, multiplayer::modes::GameMode, player_current_hp, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

pub struct BasicInfoHud {
    players: Vec<PlayerHud>
}

impl BasicInfoHud {
    pub fn new() -> Self {
        Self {
            players: (0..MAX_PLAYERS).map(PlayerHud::new).collect()
        }
    }

    pub fn update(&mut self) {
        self.players.iter_mut().for_each(|p| p.update());
    }

    pub fn ui(&self, is_dead: bool, game_mode: &GameMode) -> View {
        let active_players = currently_active_players();        
        let include_header = active_players.len() > 1;
        let max_hp_to_show = if is_dead { -99.0 } else { 60.0 };
        let max_hp = game_mode.player_hp();

        zstack!(
            Spacing::SM,
            COLOR_TRANSPARENT,
            View::VStack { 
                spacing: Spacing::SM, 
                children: self.players
                    .iter()
                    .filter_map(|p| {
                        if active_players.contains(&p.player) {
                            Some(p.ui(include_header, max_hp_to_show, max_hp))
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

    fn ui(&self, include_header: bool, max_hp_to_show: f32, max_hp: f32) -> View {
        if self.hp <= 0.00001 {
            empty_view()
        } else {
            hstack!(
                Spacing::LG,
                self.header_ui(include_header),
                self.ammo_count_ui(),
                self.hp_ui(max_hp_to_show, max_hp)
            )
        }
    }

    fn header_ui(&self, include_header: bool) -> View {
        if include_header {
            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(Typography::PlayerHudSmallTitle, format!("P{}", self.player + 1))
            )
        } else {
            empty_view()
        }
    }

    fn hp_ui(&self, max_hp_to_show: f32, max_hp: f32) -> View {
        let hp_percent = 100.0 * self.hp / max_hp;
        
        if hp_percent < max_hp_to_show {
            let typography = if hp_percent < 30.0 { Typography::PlayerHudHighlight } else { Typography::PlayerHudText };

            vstack!(
                Spacing::Zero,
                spacing!(Spacing::SM),
                text!(typography, format!("HP {:0.1}%", hp_percent))
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
                text!(Typography::PlayerHudText, format!("x{}", self.ammo_count))
            )                
        )
    }
} 