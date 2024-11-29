use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, features::dialogues::AfterDialogueBehavior, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{set_value_for_key, StorageKey}, world::World}, is_creative_mode, utils::directions::{direction_between_rects, Direction}};

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
            self.update_direction(world);
            self.move_linearly(world, time_since_last_update);
            
            if self.melee_attacks_hero {
                let updates = self.handle_melee_attack(world);                
                if !updates.is_empty() {
                    return updates
                }

                let updates = self.fuse_with_other_creeps_if_possible(world);
                if !updates.is_empty() {
                    return updates
                }
            }
        }

        if !world.is_hero_around_and_on_collision_with(&self.frame) {
            return vec![]
        }

        if world.has_confirmation_key_been_pressed {
            self.direction = direction_between_rects(&self.frame, &world.cached_hero_props.hittable_frame);

            if is_creative_mode() {
                let vec = vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::ShowEntityOptions(
                            Box::new(self.clone())
                        )
                    )
                ];
                return vec;  
            }
        }

        if let Some(dialogue) = self.next_dialogue(world) {
            self.is_in_interaction_range = true;

            if world.has_confirmation_key_been_pressed {
                self.demands_attention = false;
                set_value_for_key(&StorageKey::npc_interaction(self.id), 1);

                let show_dialogue = vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::DisplayLongText(format!("{}:", self.name.clone()), dialogue.localized_text())
                    )
                ];
                let reward = dialogue.handle_reward();
                let vanishing = self.handle_after_dialogue();
                return vec![show_dialogue, reward, vanishing].into_iter().flatten().collect();
            }
        }             
        
        vec![]
    }

    fn handle_after_dialogue(&mut self) -> Vec<WorldStateUpdate> {
        match self.after_dialogue {
            AfterDialogueBehavior::Nothing => vec![],
            AfterDialogueBehavior::Disappear => vec![WorldStateUpdate::RemoveEntity(self.id)],
            AfterDialogueBehavior::FlyAwayEast => {
                self.is_rigid = false;
                self.direction = Direction::Left;
                self.reset_speed();
                vec![]
            }
        }
    }
}