use crate::{constants::SPRITE_SHEET_HUMANOIDS_1X2, entities::known_species::is_monster, features::animated_sprite::AnimatedSprite, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, utils::rect::IntRect};

impl Entity {
    pub fn fuse_with_other_creeps_if_possible(&mut self, world: &World) -> Vec<WorldStateUpdate> {
        if !is_monster(self.species_id) {
            return vec![]
        }
        if self.is_dying {
            return vec![]
        }

        let hit = world.entities_map[self.frame.y as usize][self.frame.x as usize];
        
        if self.is_valid_hit_target(hit) && world.is_creep(hit) {
            self.sprite = AnimatedSprite::new(
                SPRITE_SHEET_HUMANOIDS_1X2, 
                IntRect::new(44, 0, 1, 2), 
                4
            );
            self.is_invulnerable = true;
            return vec![WorldStateUpdate::RemoveEntity(hit)]
        }
        vec![]
    }
}