use crate::{constants::SPRITE_SHEET_INVENTORY, entities::known_species::SPECIES_KUNAI, game_engine::inventory::{get_inventory_items, InventoryItem}, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::vector::Vector2d, vstack, zstack};

pub struct InventoryRecap {
    items: Vec<InventoryItem>
}

impl InventoryRecap {
    pub fn new() -> Self {
        let mut recap = Self { items: vec![] };
        recap.update();
        recap
    }

    pub fn update(&mut self) {
        self.items = get_inventory_items();
    }

    pub fn ui(&self) -> View {
        zstack!(
            Spacing::MD,      
            COLOR_TRANSPARENT,  
            View::VStack {
                spacing: Spacing::LG, 
                children: self.items.iter().map(|i| self.item_ui(i)).collect()
            }
        )
    }

    fn item_ui(&self, item: &InventoryItem) -> View {
        if item.species_id != SPECIES_KUNAI || item.count == 0 {
            return empty_view()
        }
        let image = texture!(SPRITE_SHEET_INVENTORY, item.texture_source_rect, Vector2d::new(1.0, 1.0));
        
        if item.count > 1 {
            zstack!(
                Spacing::Zero,
                COLOR_TRANSPARENT,
                image,
                vstack!(
                    Spacing::Zero,
                    spacing!(Spacing::LG),
                    text!(Typography::Caption, format!("x{}", item.count))
                )
            )
        } else {
            image
        }
    }
} 