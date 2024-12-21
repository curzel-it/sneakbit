use game_core::{constants::{SPRITE_SHEET_INVENTORY, SPRITE_SHEET_WEAPONS}, entities::{known_species::SPECIES_KUNAI_LAUNCHER, species::{EntityType, Species}}, equipment::basics::{available_weapons, is_equipped, set_equipped}, features::storage::inventory_count, input::keyboard_events_provider::KeyboardEventsProvider, lang::localizable::LocalizableText, text, texture, ui::{components::{empty_view, GridSpacing, Spacing, Typography, View, COLOR_MENU_BACKGROUND, COLOR_TEXT_HIGHLIGHTED}, scaffold::scaffold}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

use crate::GameContext;

use super::menu::MENU_BORDERS_TEXTURES;

pub fn update_weapons_selection(context: &mut GameContext, keyboard: &KeyboardEventsProvider) {
    if context.weapons_selection.is_open() {
        context.weapons_selection.update(keyboard);
    } else if !context.is_dead() {    
        if let Some(player) = keyboard.index_of_any_player_who_is_pressing_weapon_selection() {
            context.weapons_selection.show(player);    
        }
    }
    
}

#[derive(Debug)]
pub struct WeaponsGrid {
    weapons: Vec<Species>,
    state: WeaponsGridState,
    player: usize,
    columns: usize
}

#[derive(Debug, Clone)]
enum WeaponsGridState {
    Closed,
    SelectingWeapon(usize),
}

impl WeaponsGrid {
    pub fn new() -> Self {
        Self {
            weapons: vec![],
            state: WeaponsGridState::Closed,
            player: 0,
            columns: 5
        }
    }

    fn update(&mut self, keyboard: &KeyboardEventsProvider) {
        if keyboard.has_back_been_pressed(self.player) {
            self.state = WeaponsGridState::Closed
        } else {
            match self.state {
                WeaponsGridState::Closed => {},
                WeaponsGridState::SelectingWeapon(selected_index) => {
                    self.handle_selection_input(selected_index, keyboard);
                }
            }
        }
    }

    fn show(&mut self, player: usize) {
        self.player = player;
        self.weapons = available_weapons(self.player);

        if self.weapons.len() <= 1 {
            return
        }
        let current_index = self.weapons
            .iter()
            .enumerate()
            .find(|(_, weapon)| is_equipped(weapon, self.player))
            .map(|(index, _)| index);
        
        if let Some(current_index) = current_index {
            self.state = WeaponsGridState::SelectingWeapon(current_index)
        } else {
            self.state = WeaponsGridState::SelectingWeapon(0)
        }      
    } 

    fn is_open(&self) -> bool {
        !matches!(self.state, WeaponsGridState::Closed)
    }

    fn handle_selection_input(&mut self, selected_index: usize, keyboard: &KeyboardEventsProvider) {
        let total_weapons = self.weapons.len();
        if total_weapons == 0 {
            return;
        }

        let mut new_index = selected_index;

        if keyboard.is_direction_up_pressed_by_anyone() {
            if new_index >= self.columns {
                new_index -= self.columns;
            } else {
                new_index = (new_index + total_weapons).saturating_sub(self.columns);
            }
        }
        if keyboard.is_direction_down_pressed_by_anyone() {
            if new_index + self.columns < total_weapons {
                new_index += self.columns;
            } else {
                new_index = (new_index + self.columns) % total_weapons;
            }
        }
        if keyboard.is_direction_left_pressed_by_anyone() && new_index > 0 {
            new_index -= 1;
        }
        if keyboard.is_direction_right_pressed_by_anyone() && new_index < total_weapons - 1 {
            new_index += 1;
        }

        self.state = WeaponsGridState::SelectingWeapon(new_index);

        if keyboard.has_confirmation_been_pressed_by_anyone() {
            self.handle_confirmation_input(new_index);
            self.state = WeaponsGridState::Closed;
        }
    }

    fn handle_confirmation_input(&mut self, selected_index: usize) {
        if let Some(selected_weapon) = self.weapons.get(selected_index) {
            set_equipped(selected_weapon, self.player);
            self.state = WeaponsGridState::Closed;
        }
    }

    pub fn ui(&self) -> View {
        match &self.state {
            WeaponsGridState::Closed => empty_view(),
            WeaponsGridState::SelectingWeapon(selected_index) => {
                scaffold(
                    true,
                    COLOR_MENU_BACKGROUND,
                    Some(MENU_BORDERS_TEXTURES),
                    self.regular_ui(*selected_index),
                )
            }
        }
    }

    fn regular_ui(&self, selected_weapon_index: usize) -> View {
        let selected_weapon = self.weapons.get(selected_weapon_index);

        let weapons_grid = View::VGrid {
            spacing: GridSpacing::sm(),
            columns: self.columns,
            children: self
                .weapons
                .iter()
                .enumerate()
                .map(|(index, weapon)| self.weapon_ui(index, selected_weapon_index, weapon))
                .collect(),
        };

        let weapon_info = if let Some(weapon) = selected_weapon {
            let ammo_text = if matches!(weapon.entity_type, EntityType::WeaponRanged) {
                let ammo = inventory_count(&weapon.bullet_species_id, self.player);
                let text = format!("{}: {}", "weapons_selection.ammo".localized(), ammo);
                text!(Typography::Regular, text)
            } else {
                text!(Typography::Regular, "--".localized())
            };            
            vstack!(
                Spacing::MD,
                text!(Typography::Title, weapon.name.localized()),
                ammo_text
            )
        } else {
            empty_view()
        };

        View::VStack {
            spacing: Spacing::LG,
            children: vec![
                text!(Typography::Title, "weapons_selection.title".localized()),
                weapons_grid,
                weapon_info,
            ],
        }
    }

    fn weapon_ui(&self, index: usize, selected_index: usize, weapon: &Species) -> View {
        if index == selected_index {
            zstack!(
                Spacing::XS,
                COLOR_TEXT_HIGHLIGHTED,
                self.weapon_icon(weapon, true)
            )
        } else {
            self.weapon_icon(weapon, false)
        }
    }

    fn weapon_icon(&self, weapon: &Species, is_selected: bool) -> View {
        let is_visible_in_game = !matches!(weapon.id, SPECIES_KUNAI_LAUNCHER);
        
        let sprite_sheet = if is_selected && is_visible_in_game { 
            SPRITE_SHEET_WEAPONS 
        } else { 
            SPRITE_SHEET_INVENTORY
        };
        
        let texture_rect = if is_selected && is_visible_in_game {
            IntRect::new(weapon.sprite_frame.x, 57, 2, 2)
        } else {
            let (y, x) = weapon.inventory_texture_offset;
            IntRect::new(x, y, 1, 1)
        };

        let size = if is_selected { 2.0 } else { 1.5 };
        texture!(sprite_sheet, texture_rect, Vector2d::new(size, size))
    }
}