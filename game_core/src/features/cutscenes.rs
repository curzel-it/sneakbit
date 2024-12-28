use serde::{Deserialize, Serialize};

use crate::{constants::SPRITE_SHEET_BLANK, features::{entity::Entity, state_updates::WorldStateUpdate, storage::{get_value_for_global_key, set_value_for_key}}, utils::rect::FRect, RenderableItem};

use super::animated_sprite::AnimatedSprite;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CutScene {
    key: String,
    idle_sprite: AnimatedSprite,
    play_sprite: AnimatedSprite,
    frame: FRect,
    trigger_position: (f32, f32),
    on_end: Vec<Entity>,

    #[serde(skip)]
    did_setup: bool,

    #[serde(skip)]
    is_playing: bool,

    #[serde(skip)]
    did_pass_first_frame: bool,
}

impl CutScene {
    pub fn renderable_item(&self) -> RenderableItem {
        let sprite = if self.is_playing { &self.play_sprite } else { &self.idle_sprite };

        RenderableItem {
            sprite_sheet_id: sprite.sheet_id,
            texture_rect: sprite.frame,
            frame: self.frame,
            sorting_key: 2_000_000_000
        }
    }

    pub fn update(&mut self, hero_frame: &FRect, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let did_already_play = get_value_for_global_key(&self.key).unwrap_or_default() == 1;

        if !self.did_setup {
            self.did_setup = true;

            if did_already_play {
                self.hide();
            }
        }

        if did_already_play {
            return vec![];
        }

        if self.is_playing {
            self.play_sprite.update(time_since_last_update);

            if self.did_pass_first_frame && self.play_sprite.frame.x == self.play_sprite.original_frame.x {
                set_value_for_key(&self.key, 1);
                self.hide();

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

            if hero_frame.x == self.trigger_position.0 && hero_frame.y == self.trigger_position.1 {
                self.is_playing = true;
            }
        }

        vec![]
    }

    fn hide(&mut self) {
        self.is_playing = false;
        self.idle_sprite.sheet_id = SPRITE_SHEET_BLANK;
        self.idle_sprite.frame = FRect::square_from_origin(1.0);
    }
}