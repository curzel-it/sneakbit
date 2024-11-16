use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{set_value_for_key, StorageKey}, world::World}, utils::directions::direction_between_rects};

pub type NpcId = u32;

impl Entity {
    pub fn setup_npc(&mut self) {
        if self.sprite.sheet_id == SPRITE_SHEET_HUMANOIDS_1X2 {
            self.update_sprite_for_current_state();
        }
    }

    pub fn update_npc(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        if self.sprite.supports_directions {
            self.update_sprite_for_current_state();
        }
        
        if !world.creative_mode {
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

        if world.is_hero_around_and_on_collision_with(&self.frame) {
            self.direction = direction_between_rects(&self.frame, &world.cached_hero_props.hittable_frame);

            if world.creative_mode {
                let vec = vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::ShowEntityOptions(
                            Box::new(self.clone())
                        )
                    )
                ];
                return vec;  
            } else if let Some(dialogue) = self.next_dialogue(world) {
                self.demands_attention = false;

                set_value_for_key(&StorageKey::npc_interaction(self.id), 1);

                let show_dialogue = vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::DisplayLongText(format!("{}:", self.name.clone()), dialogue.localized_text())
                    )
                ];

                let reward = dialogue.handle_reward();

                let vanishing = if self.vanishes_after_dialogue {
                    vec![WorldStateUpdate::RemoveEntity(self.id)]
                } else {
                    vec![]
                };

                return vec![show_dialogue, reward, vanishing].into_iter().flatten().collect();
            }             
        }  
        vec![]
    }
}