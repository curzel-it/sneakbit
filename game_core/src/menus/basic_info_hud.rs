use crate::{constants::SPRITE_SHEET_INVENTORY, current_hero_hp, number_of_kunai_in_inventory, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

pub struct BasicInfoHud {
    number_of_kunais: i32,
    hp: f32
}

impl BasicInfoHud {
    pub fn new() -> Self {
        Self { 
            number_of_kunais: 0,
            hp: 0.0
        }
    }    

    pub fn update(&mut self) {
        self.number_of_kunais = number_of_kunai_in_inventory();
        self.hp = current_hero_hp();
    }

    pub fn ui(&self) -> View {
        vstack!(
            Spacing::Zero,
            self.ammo_ui(),
            self.hp_ui()
        )
    }

    fn hp_ui(&self) -> View {
        if self.hp < 60.0 {
            let typography = if self.hp < 30.0 { Typography::Selected } else { Typography::Regular };
            zstack!(
                Spacing::MD,
                COLOR_TRANSPARENT,
                text!(typography, format!("HP {:0.1}%", self.hp))
            )
        } else {
            empty_view()
        }
    }

    fn ammo_ui(&self) -> View {
        if self.number_of_kunais > 0 {
            let image = texture!(SPRITE_SHEET_INVENTORY, IntRect::new(1, 7, 1, 1), Vector2d::new(1.5, 1.5));

            zstack!(
                Spacing::MD,
                COLOR_TRANSPARENT,
                image,
                vstack!(
                    Spacing::Zero,
                    spacing!(Spacing::XL),
                    text!(Typography::Regular, format!("x{}", self.number_of_kunais))
                )
            )
        } else {
            empty_view()
        }
    }
} 