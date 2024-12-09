use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, entities::known_species::is_monster, features::animated_sprite::AnimatedSprite, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, utils::rect::IntRect};

impl Entity {
    pub fn fuse_with_other_creeps_if_possible(&mut self, world: &World) -> Vec<WorldStateUpdate> {
        if !is_monster(self.species_id) {
            return vec![]
        }
        if self.is_dying {
            return vec![]
        }

        let hits = world.entity_ids(self.frame.x, self.frame.y);

        for hit in hits {        
            if self.is_valid_hit_target(hit) && world.is_creep(hit) {
                self.sprite = next_sprite(self.sprite.original_frame.x);
                self.hp = next_hp(self.sprite.original_frame.x);
                return vec![WorldStateUpdate::RemoveEntity(hit)]
            }
        }
        vec![]
    }
}

fn next_sprite(current_sprite_x: i32) -> AnimatedSprite {
    let (x, y) = match current_sprite_x {
        28 => (44, 0),
        44 => (24, 38),
        24 => (24, 38),
        _ => (28, 0)
    };
    AnimatedSprite::new(
        SPRITE_SHEET_HUMANOIDS_1X2, 
        IntRect::new(x, y, 1, 2), 
        4
    )
}

fn next_hp(current_sprite_x: i32) -> f32 {
    match current_sprite_x {
        28 => 100.0,
        44 => 600.0,
        24 => 1300.0,
        _ => 100.0
    }
}