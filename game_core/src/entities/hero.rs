use crate::{constants::{HERO_KUNAI_COOLDOWN, TILE_SIZE}, entities::{known_species::SPECIES_KUNAI, species::species_by_id}, game_engine::{entity::Entity, inventory::{inventory_contains_species, remove_one_of_species_from_inventory}, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World}};

impl Entity {
    pub fn setup_hero(&mut self, creative_mode: bool) {
        self.speed_multiplier = if creative_mode { 2.0 } else { 1.0 };
    }

    pub fn update_hero(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {        
        let mut world_updates: Vec<WorldStateUpdate> = vec![];

        if !(world.is_hero_on_slippery_surface() && self.current_speed > 0.0) {
            self.update_direction(world);
            self.update_sprite_for_current_state();
        } else {
            self.update_sprite_for_direction_speed(self.direction, 0.0);
        }
        
        self.time_immobilized -= time_since_last_update;
        if self.time_immobilized <= 0.0 {
            self.move_linearly(world, time_since_last_update)
        }
        
        world_updates.push(self.cache_props());
        world_updates.push(self.move_camera_update());
        world_updates.append(&mut self.shoot_kunai(world, time_since_last_update));
        world_updates
    }

    fn cache_props(&self) -> WorldStateUpdate {
        WorldStateUpdate::CacheHeroProps(
            Box::new(self.props())
        )
    }

    fn move_camera_update(&self) -> WorldStateUpdate {
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::CenterCamera(
                self.frame.x, 
                self.frame.y,
                self.offset
            )
        )
    }
    
    fn shoot_kunai(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        self.shooting_cooldown_remaining -= time_since_last_update;
        
        if self.shooting_cooldown_remaining > 0.0 {
            return vec![]
        }
        if !world.has_attack_key_been_pressed {
            return vec![]
        }
        if !inventory_contains_species(SPECIES_KUNAI) {
            return vec![]
        }

        self.shooting_cooldown_remaining = HERO_KUNAI_COOLDOWN;
        remove_one_of_species_from_inventory(&SPECIES_KUNAI);

        let mut bullet = species_by_id(SPECIES_KUNAI).make_entity();
        bullet.direction = world.cached_hero_props.direction;
        let (dx, dy) = bullet.direction.as_col_row_offset();
        bullet.frame = world.cached_hero_props.frame.offset(dx, dy).offset_y(1).with_h(1);
        
        if self.offset.x > TILE_SIZE / 2.0 { bullet.frame.x += 1 }
        if self.offset.x < -TILE_SIZE / 2.0 { bullet.frame.x -= 1 }
        if self.offset.y > TILE_SIZE / 2.0 { bullet.frame.y += 1 }
        if self.offset.y < -TILE_SIZE / 2.0 { bullet.frame.y -= 1 }
        
        bullet.parent_id = self.id;
        bullet.remaining_lifespan = 3.0;
        bullet.reset_speed();

        vec![WorldStateUpdate::AddEntity(Box::new(bullet))]
    }
}