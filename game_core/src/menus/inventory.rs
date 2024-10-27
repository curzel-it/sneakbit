use crate::{constants::{SPRITE_SHEET_INVENTORY, TILE_SIZE}, entities::species::{species_by_id, Species}, game_engine::{entity::Entity, inventory::get_inventory, keyboard_events_provider::KeyboardEventsProvider, state_updates::{EngineStateUpdate, WorldStateUpdate}}, lang::localizable::LocalizableText, text, texture, ui::{components::{GridSpacing, Spacing, Typography, View, COLOR_BLACK, COLOR_YELLOW}, scaffold::scaffold}, utils::{rect::IntRect, vector::Vector2d}, zstack};

use super::menu::MENU_BORDERS_TEXTURES;

#[derive(Debug)]
pub struct Inventory {
    pub stock: Vec<Entity>,
    state: InventoryState,
    columns: usize,
}

#[derive(Debug)]
enum InventoryState {
    SelectingItem(usize),
}

impl Inventory {
    pub fn new() -> Self {
        Self {
            stock: vec![],
            state: InventoryState::SelectingItem(0),
            columns: 12,
        }
    }

    pub fn setup(&mut self) {
        self.stock = get_inventory()
    }

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        match self.state {
            InventoryState::SelectingItem(selected_index) => {
                self.update_item_selection(selected_index, keyboard)
            },
        }
    }

    fn update_item_selection(&mut self, selected_index: usize, keyboard: &KeyboardEventsProvider) -> Vec<WorldStateUpdate> {
        if keyboard.direction_up.is_pressed && selected_index >= self.columns {
            self.state = InventoryState::SelectingItem(selected_index - self.columns);            
        }
        if keyboard.direction_right.is_pressed && selected_index < self.stock.len().saturating_sub(1) {
            self.state = InventoryState::SelectingItem(selected_index + 1);
        }
        if keyboard.direction_down.is_pressed && selected_index < self.stock.len().saturating_sub(self.columns) {
            self.state = InventoryState::SelectingItem(selected_index + self.columns);
        } 
        if keyboard.direction_left.is_pressed && selected_index > 0 {
            self.state = InventoryState::SelectingItem(selected_index - 1);
        }
        if keyboard.has_confirmation_been_pressed {
            return self.handle_selection(selected_index); 
        }
        vec![]
    }

    fn handle_selection(&self, selected_index: usize) -> Vec<WorldStateUpdate> {
        if selected_index >= self.stock.len() { 
            return vec![]
        }
        let item = self.stock[selected_index].clone();

        vec![
            WorldStateUpdate::EngineUpdate(
                EngineStateUpdate::ShowInventoryOptions(
                    Box::new(item)
                )
            )
        ]
    }
}

impl Inventory {
    pub fn ui(&self) -> View {
        scaffold(
            true,
            COLOR_BLACK,
            Some(MENU_BORDERS_TEXTURES),
            match self.state {
                InventoryState::SelectingItem(selected_index) => self.regular_ui(selected_index),                
            }
        )
    }
    
    fn regular_ui(&self, selected_item_index: usize) -> View {
        let ui_elements = vec![
            text!(Typography::Title, "inventory.title".localized()),
            text!(Typography::Regular, "inventory.subtitle".localized()),
            View::VGrid {
                spacing: GridSpacing::sm(),
                columns: self.columns,
                children: self.stock.iter()
                    .map(|e| e.species_id)
                    .map(species_by_id)
                    .enumerate()
                    .map(|(index, species)| { self.item_ui(&species, index, selected_item_index) })
                    .collect()
            },
        ];

        View::VStack { spacing: Spacing::LG, children: ui_elements }
    }

    fn item_ui(&self, item: &Species, index: usize, selected_index: usize) -> View {
        let selected_size = 1.5 - 2.0 * Spacing::XS.unscaled_value() / TILE_SIZE;
        let (y, x) = item.inventory_texture_offset;
        let texture_source_rect = IntRect::new(x, y, 1, 1);

        if index == selected_index {
            zstack!(
                Spacing::XS, 
                COLOR_YELLOW,
                texture!(
                    SPRITE_SHEET_INVENTORY, 
                    texture_source_rect, 
                    Vector2d::new(selected_size, selected_size)
                )
            )
        } else {
            texture!(
                SPRITE_SHEET_INVENTORY, 
                texture_source_rect, 
                Vector2d::new(1.5, 1.5)
            )
        }
    }
}