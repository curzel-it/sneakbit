use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, features::{entity::Entity, state_updates::WorldStateUpdate}, utils::{rect::FRect, vector::Vector2d}, worlds::world::World};

pub type NpcId = u32;

impl Entity {
    pub fn setup_npc(&mut self) {
        if self.sprite.sheet_id == SPRITE_SHEET_HUMANOIDS_1X2 {
            self.update_sprite_for_current_state();
        }
    }

    pub fn update_npc(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> { 
        self.is_in_interaction_range = false;

        if self.sprite.supports_directions {
            self.update_sprite_for_current_state();
        }

        if !self.dialogues.is_empty() && world.is_hero_around_and_on_collision_with(&self.frame) {            
            if world.has_confirmation_key_been_pressed_by_anyone {
                self.direction = Vector2d::direction_to(&self.frame.center(), &world.players[0].props.hittable_frame.center());
                self.update_sprite_for_current_state();
            }         
            
            return self.handle_dialogue_interaction(world).unwrap_or_default()
        }
        vec![]
    }

    pub fn npc_hittable_frame(&self) -> FRect {
        let x_offset = 0.15;
        let y_offset = if self.frame.h > 1.0 { 1.15 } else { 0.1 };
        let width = self.frame.w - 0.3;
        let height = self.frame.h - if self.frame.h > 1.0 { 1.35 } else { 0.2 };

        FRect {
            x: self.frame.x + x_offset,
            y: self.frame.y + y_offset,
            w: width,
            h: height
        }
    }
}