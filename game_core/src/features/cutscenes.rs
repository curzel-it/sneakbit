use serde::{Deserialize, Serialize};

use crate::{game_engine::{entity::Entity, state_updates::WorldStateUpdate, storage::{get_value_for_global_key, set_value_for_key}, world::World}, utils::rect::IntRect};

use super::animated_sprite::AnimatedSprite;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CutScene {
    key: String,
    idle_sprite: AnimatedSprite,
    play_sprite: AnimatedSprite,
    frame: IntRect,
    trigger_position: (i32, i32),
    on_end: Vec<Entity>,

    #[serde(skip)]
    is_playing: bool,

    #[serde(skip)]
    did_pass_first_frame: bool,
}

impl CutScene {
    pub fn update(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        if get_value_for_global_key(&self.key).unwrap_or_default() == 1 {
            return vec![];
        }

        if self.is_playing {
            self.play_sprite.update(time_since_last_update);

            if self.did_pass_first_frame && self.play_sprite.frame.x == self.play_sprite.original_frame.x {
                set_value_for_key(&self.key, 1);

                return self.on_end
                    .clone()
                    .into_iter()
                    .map(|e| WorldStateUpdate::AddEntity(Box::new(e)))
                    .collect()
            }

            if !self.did_pass_first_frame && self.play_sprite.frame.x > self.play_sprite.original_frame.x {
                self.did_pass_first_frame = true
            }
        } else {
            self.idle_sprite.update(time_since_last_update);           

            if world.is_hero_at(self.trigger_position.0, self.trigger_position.1) {
                self.is_playing = true;
            }
        }

        vec![]
    }
}