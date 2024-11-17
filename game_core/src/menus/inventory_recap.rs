use crate::{constants::SPRITE_SHEET_INVENTORY, number_of_kunai_in_inventory, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

pub struct InventoryRecap {
    number_of_kunais: i32
}

impl InventoryRecap {
    pub fn new() -> Self {
        let mut recap = Self { number_of_kunais: 0 };
        recap.update();
        recap
    }    

    pub fn update(&mut self) {
        self.number_of_kunais = number_of_kunai_in_inventory();
    }

    pub fn ui(&self) -> View {
        if self.number_of_kunais > 0 {
            let image = texture!(SPRITE_SHEET_INVENTORY, IntRect::new(1, 7, 1, 1), Vector2d::new(1.0, 1.0));

            zstack!(
                Spacing::MD,
                COLOR_TRANSPARENT,
                image,
                vstack!(
                    Spacing::Zero,
                    spacing!(Spacing::LG),
                    text!(Typography::Caption, format!("x{}", self.number_of_kunais))
                )
            )
        } else {
            empty_view()
        }
    }
} 