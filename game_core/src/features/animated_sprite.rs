use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{constants::{ANIMATIONS_FPS, SPRITE_SHEET_BLANK, SPRITE_SHEET_HEROES, SPRITE_SHEET_HUMANOIDS_1X1, SPRITE_SHEET_HUMANOIDS_1X2, SPRITE_SHEET_HUMANOIDS_2X2, SPRITE_SHEET_MONSTERS, SPRITE_SHEET_WEAPONS}, features::entity::Entity, utils::{math::ZeroComparable, rect::FRect, timed_content_provider::TimedContentProvider, vector::Vector2d}};

#[derive(Debug, Clone)]
pub struct AnimatedSprite {
    pub sheet_id: u32,
    pub frame: FRect,
    pub supports_directions: bool,
    pub original_frame: FRect,
    number_of_frames: i32,
    frames_provider: TimedContentProvider<f32>,
}

impl AnimatedSprite {
    pub fn new(sheet_id: u32, frame: FRect, number_of_frames: i32) -> Self {
        Self {
            sheet_id,
            frame,
            supports_directions: supports_directions(sheet_id),
            original_frame: frame,
            number_of_frames,
            frames_provider: TimedContentProvider::frames(frame.x, number_of_frames, frame.w),
        }
    }

    pub fn update(&mut self, time_since_last_update: f32) {
        if self.number_of_frames > 1 {
            self.frames_provider.update(time_since_last_update);
            self.frame.x = *self.frames_provider.current_frame();
        }
    }

    pub fn texture_source_rect(&self) -> FRect {
        self.frame
    }

    pub fn completed_loops(&self) -> u32 {
        self.frames_provider.completed_loops
    }

    pub fn reset(&mut self) {
        self.frames_provider =
            TimedContentProvider::frames(self.original_frame.x, self.number_of_frames, self.original_frame.w);
    }
}

impl Entity {
    /// Updates the sprite based on the current state of the entity.
    pub fn update_sprite_for_current_state(&mut self) {
        if !self.is_dying {
            if self.demands_attention {
                // Assuming row 8 is reserved for attention-demanding state
                self.sprite.frame.y = self.sprite.original_frame.y + self.sprite.frame.h * 8.0;
            } else {
                self.update_sprite_for_direction_speed(self.direction, self.current_speed);
            }
        }
    }

    /// Updates the sprite's row based on the direction vector and speed.
    pub fn update_sprite_for_direction_speed(&mut self, direction: Vector2d, speed: f32) {
        let row = Self::determine_sprite_row(direction, speed);
        self.sprite.frame.y = self.sprite.original_frame.y + self.sprite.frame.h * row as f32;
    }

    /// Determines the appropriate sprite sheet row based on direction and speed.
    fn determine_sprite_row(direction: Vector2d, speed: f32) -> usize {
        if speed != 0.0 && !direction.is_zero() {
            // Determine the primary direction based on the dominant axis
            if direction.x.abs() > direction.y.abs() {
                if direction.x > 0.0 {
                    2 // Right moving
                } else {
                    6 // Left moving
                }
            } else {
                if direction.y > 0.0 {
                    4 // Down moving
                } else {
                    0 // Up moving
                }
            }
        } else {
            // Idle state based on the last known direction or default to Down idle
            if direction.x.abs() > direction.y.abs() {
                if direction.x > 0.0 {
                    3 // Right idle
                } else {
                    7 // Left idle
                }
            } else {
                if direction.y > 0.0 {
                    5 // Down idle
                } else {
                    1 // Up idle
                }
            }
        }
    }
}

impl TimedContentProvider<f32> {
    pub fn frames(x: f32, n: i32, w: f32) -> Self {
        let frames = (0..n).map(|i| x + i as f32 * w).collect();
        Self::new(frames, ANIMATIONS_FPS)
    }
}

fn supports_directions(sheet_id: u32) -> bool {
    matches!(
        sheet_id,
        SPRITE_SHEET_HUMANOIDS_1X1
            | SPRITE_SHEET_HUMANOIDS_1X2
            | SPRITE_SHEET_HUMANOIDS_2X2
            | SPRITE_SHEET_MONSTERS
            | SPRITE_SHEET_HEROES
            | SPRITE_SHEET_WEAPONS
    )
}

#[derive(Serialize, Deserialize)]
struct AnimatedSpriteData {
    sheet_id: u32,
    frame: FRect,
    number_of_frames: i32,
}

impl Serialize for AnimatedSprite {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let data = AnimatedSpriteData {
            sheet_id: self.sheet_id,
            frame: self.original_frame,
            number_of_frames: self.number_of_frames,
        };
        data.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for AnimatedSprite {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let AnimatedSpriteData {
            sheet_id,
            frame,
            number_of_frames,
        } = AnimatedSpriteData::deserialize(deserializer)?;
        let sprite = AnimatedSprite::new(sheet_id, frame, number_of_frames);
        Ok(sprite)
    }
}

impl Default for AnimatedSprite {
    fn default() -> Self {
        Self {
            sheet_id: SPRITE_SHEET_BLANK,
            frame: FRect::square_from_origin(1.0),
            supports_directions: false,
            original_frame: FRect::square_from_origin(1.0),
            number_of_frames: 1,
            frames_provider: TimedContentProvider::new(vec![0.0], ANIMATIONS_FPS),
        }
    }
}