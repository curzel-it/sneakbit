use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{constants::{ANIMATIONS_FPS, SPRITE_SHEET_HUMANOIDS}, utils::{rect::Rect, timed_content_provider::TimedContentProvider}};

#[derive(Debug)]
pub struct AnimatedSprite {
    pub sheet_id: u32,
    pub index: u32,
    pub row: u32,
    pub frames_provider: TimedContentProvider<u32>,
    pub width: u32,
    pub height: u32,
    number_of_frames: u32,
}

impl AnimatedSprite {
    pub fn new(sheet_id: u32, number_of_frames: u32, width: u32, height: u32) -> Self {
        Self {
            sheet_id,
            index: 0,
            row: 0,
            frames_provider: TimedContentProvider::frames_counter(number_of_frames),
            width,
            height,
            number_of_frames,
        }
    }

    pub fn new_humanoid(index: u32) -> Self {
        let mut sprite = AnimatedSprite::new(
            SPRITE_SHEET_HUMANOIDS, 
            4, 
            1, 
            2
        );
        sprite.index = index;
        sprite
    }

    pub fn update(&mut self, time_since_last_update: f32) {
        self.frames_provider.update(time_since_last_update)
    }

    pub fn texture_source_rect(&self) -> Rect {
        Rect::new(
            (self.index * self.width * self.number_of_frames) + self.frames_provider.current_frame(),
            self.row * self.height,
            self.width,
            self.height
        )
    }
}

impl TimedContentProvider<u32> {
    pub fn frames_counter(n: u32) -> Self {
        let frames = Vec::from_iter(0..n);
        Self::new(frames, ANIMATIONS_FPS)
    }
}

#[macro_export]
macro_rules! impl_humanoid_sprite_update {
    ($struct_name:ident) => {
        impl $struct_name {
            fn update_sprite(&mut self, time_since_last_update: f32) {
                let direction = $crate::utils::geometry_utils::Direction::from_vector(self.body.direction);
                let is_moving = self.body.current_speed != 0.0;
        
                self.sprite.row = match (direction, is_moving) {
                    ($crate::utils::geometry_utils::Direction::Up, true) => 0,
                    ($crate::utils::geometry_utils::Direction::Up, false) => 1,
                    ($crate::utils::geometry_utils::Direction::Right, true) => 2,
                    ($crate::utils::geometry_utils::Direction::Right, false) => 3,
                    ($crate::utils::geometry_utils::Direction::Down, true) => 4,
                    ($crate::utils::geometry_utils::Direction::Down, false) => 5,
                    ($crate::utils::geometry_utils::Direction::Left, true) => 6,
                    ($crate::utils::geometry_utils::Direction::Left, false) => 7,
                    ($crate::utils::geometry_utils::Direction::Unknown, true) => 5,
                    ($crate::utils::geometry_utils::Direction::Unknown, false) => 5
                };
                self.sprite.update(time_since_last_update);
            }
        }
    };
}

#[macro_export]
macro_rules! impl_bullet_sprite_update {
    ($struct_name:ident) => {
        impl $struct_name {
            fn update_sprite(&mut self, time_since_last_update: f32) {
                let direction = $crate::utils::geometry_utils::Direction::from_vector(self.body.direction);
        
                self.sprite.row = match direction {
                    $crate::utils::geometry_utils::Direction::Up => 2,
                    $crate::utils::geometry_utils::Direction::Right => 0,
                    $crate::utils::geometry_utils::Direction::Down => 3,
                    $crate::utils::geometry_utils::Direction::Left => 1,
                    $crate::utils::geometry_utils::Direction::Unknown => 3,
                };
                self.sprite.update(time_since_last_update);
            }
        }
    };
}

#[derive(Serialize, Deserialize)]
struct AnimatedSpriteData {
    sheet_id: u32,
    index: u32,
    width: u32,
    height: u32,
    number_of_frames: u32,
}

impl Serialize for AnimatedSprite {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let data = AnimatedSpriteData {
            sheet_id: self.sheet_id,
            index: self.index,
            width: self.width,
            height: self.height,
            number_of_frames: self.number_of_frames,
        };
        data.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for AnimatedSprite {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        let data = AnimatedSpriteData::deserialize(deserializer)?;
        let mut sprite = AnimatedSprite::new(data.sheet_id, data.number_of_frames, data.width, data.height);
        sprite.index = data.index;
        Ok(sprite)
    }
}
