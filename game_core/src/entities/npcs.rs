use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, features::{entity::Entity, state_updates::WorldStateUpdate}, is_creative_mode, utils::directions::Direction, worlds::world::World};

pub type NpcId = u32;

impl Entity {
    pub fn setup_npc(&mut self) {
        if self.sprite.sheet_id == SPRITE_SHEET_HUMANOIDS_1X2 {
            self.update_sprite_for_current_state();
        }
    }

    pub fn update_npc(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> { 
        self.is_in_interaction_range = false;

        if self.sprite.supports_directions {
            self.update_sprite_for_current_state();
        }
        
        if !is_creative_mode() {
            self.update_direction(world, time_since_last_update);
            self.move_linearly(world, time_since_last_update);
        }

        if !self.dialogues.is_empty() && world.is_hero_around_and_on_collision_with(&self.frame) {            
            if world.has_confirmation_key_been_pressed_by_anyone {
                self.direction = Direction::between_rects(&self.frame, &world.players[0].props.hittable_frame);
                self.update_sprite_for_current_state();
            }         
            
            return self.handle_dialogue_interaction(world).unwrap_or_default()
        }
        vec![]
    }
}