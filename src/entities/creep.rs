use crate::{constants::INFINITE_LIFESPAN, features::{animated_sprite::AnimatedSprite, autoremove::remove_automatically, linear_movement::move_linearly, position_seeker::set_direction_towards}, game_engine::{entity::Entity, entity_body::EntityBody, entity_factory::get_next_entity_id, state_updates::WorldStateUpdate, world::World}, impl_embodied_entity, impl_humanoid_sprite_update, utils::{geometry_utils::Insets, rect::Rect, vector::Vector2d}};

#[derive(Debug)]
pub struct Creep {
    body: EntityBody,
    sprite: AnimatedSprite,
}

impl Creep {
    pub fn new(parent: &dyn Entity) -> Self {
        Self {             
            body: EntityBody {
                id: get_next_entity_id(),
                parent_id: parent.id(),
                frame: Rect::new(0.0, 0.0, 19.0, 22.0),
                collision_insets: Insets::new(8.0, 1.0, 0.0, 1.0),
                direction: Vector2d::zero(),
                current_speed: 1.5,
                base_speed: 1.5,
                hp: 100.0,
                dp: 0.0,
                creation_time: 0.0,
                requires_collision_detection: true,
                is_rigid: true,
                z_index: 0,
                is_ally: parent.body().is_ally,
                lifespan: INFINITE_LIFESPAN,
            },
            sprite: AnimatedSprite::new("white", 3, 19, 22)
        }
    }
}

impl_embodied_entity!(Creep);
impl_humanoid_sprite_update!(Creep);

impl Entity for Creep {
    fn update(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let mut world_updates: Vec<WorldStateUpdate> = vec![];
        set_direction_towards(self, &world.cached_hero_props.position());
        move_linearly(self, world, time_since_last_update);
        self.update_sprite(time_since_last_update);
        world_updates.append(&mut remove_automatically(self, world));
        world_updates
    }

    fn texture_source_rect(&self) -> Rect {
        self.sprite.texture_source_rect()
    }

    fn sprite_sheet_path(&self) -> &str {
        &self.sprite.sheet_path 
    }
}