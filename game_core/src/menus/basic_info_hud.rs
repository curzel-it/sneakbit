use crate::{constants::SPRITE_SHEET_INVENTORY, current_hero_hp, number_of_cannonball_in_inventory, number_of_kunai_in_inventory, number_of_rem223_in_inventory, shows_death_screen, spacing, text, texture, ui::components::{empty_view, Spacing, Typography, View, COLOR_TRANSPARENT}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

pub struct BasicInfoHud {
    number_of_kunais: i32,
    number_of_cannonball: i32,
    number_of_rem223: i32,
    hp: f32
}

impl BasicInfoHud {
    pub fn new() -> Self {
        Self { 
            number_of_kunais: 0,
            number_of_cannonball: 0,
            number_of_rem223: 0,
            hp: 0.0
        }
    }    

    pub fn update(&mut self) {
        self.number_of_kunais = number_of_kunai_in_inventory();
        self.number_of_cannonball = number_of_cannonball_in_inventory();
        self.number_of_rem223 = number_of_rem223_in_inventory();
        self.hp = current_hero_hp();
    }

    pub fn ui(&self) -> View {
        vstack!(
            Spacing::Zero,
            self.ammo_count_ui(self.number_of_kunais, 7, 1),
            self.ammo_count_ui(self.number_of_rem223, 11, 6),
            self.ammo_count_ui(self.number_of_cannonball, 11, 7),
            self.hp_ui()
        )
    }

    fn hp_ui(&self) -> View {
        if self.hp < 60.0 && !shows_death_screen() {
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

    fn ammo_count_ui(&self, count: i32, sprite_y: i32, sprite_x: i32) -> View {
        if self.number_of_kunais > 0 {
            let image = texture!(
                SPRITE_SHEET_INVENTORY, 
                IntRect::new(sprite_x, sprite_y, 1, 1), 
                Vector2d::new(1.5, 1.5)
            );

            zstack!(
                Spacing::MD,
                COLOR_TRANSPARENT,
                image,
                vstack!(
                    Spacing::Zero,
                    spacing!(Spacing::XL),
                    text!(Typography::Regular, format!("x{}", count))
                )
            )
        } else {
            empty_view()
        }
    }
} 