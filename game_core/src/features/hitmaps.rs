use crate::{entities::species::{EntityType, SpeciesId}, features::entity::{Entity, EntityId}, utils::{rect::FRect, vector::Vector2d}, worlds::world::World};

#[derive(Clone)]
pub struct Hitmap {
    pub data: Vec<Hittable>
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Hittable {
    pub frame: FRect,
    pub has_weight: bool,
    pub is_rigid: bool,
    pub entity_id: EntityId,
    pub species_id: SpeciesId
}

impl World {    
    pub fn area_hits(&self, exclude: &[u32], area: &FRect) -> bool {
        self.hitmap.area_hits(exclude, area) || self.tiles_hitmap.area_hits(exclude, area)
    }
    
    pub fn hits(&self, x: f32, y: f32) -> bool {
        self.hitmap.hits_xy(x, y) || self.tiles_hitmap.hits_xy(x, y) 
    }
    
    pub fn hits_or_out_of_bounds(&self, x: f32, y: f32) -> bool {
        x < 0.0 || y < 0.0 || x >= self.bounds.max_x() || y >= self.bounds.max_y() || self.hits(x, y)
    }

    pub fn hits_line(&self, exclude: &[u32], start: &Vector2d, end: &Vector2d) -> bool {
        self.hitmap.hits_line(exclude, start, end) || self.tiles_hitmap.hits_line(exclude, start, end)
    }

    pub fn entity_ids(&self, x: f32, y: f32) -> Vec<(EntityId, SpeciesId)> {
        self.hitmap.ids_xy(x, y)
    }
    
    pub fn entity_ids_by_area(&self, exclude: &[u32], area: &FRect) -> Vec<(EntityId, SpeciesId)> {
        self.hitmap.entity_ids_by_area(exclude, area)
    }

    pub fn first_entity_id_by_area(&self, exclude: &[u32], area: &FRect) -> Option<Hittable> {
        self.hitmap.first_entity_id_by_area(exclude, area)
    }

    pub fn has_weight(&self, area: &FRect) -> bool {
        self.hitmap.has_weight(area)
    }

    pub unsafe fn update_hitmaps(&mut self, viewport: &FRect) {
        self.visible_entities.clear();
        self.hitmap.data.clear();
        self.tiles_hitmap.data.clear();

        let entities = &self.entities.borrow();

        for index in 0..entities.len() {
            let entity = entities.get_unchecked(index);     
            let is_visible = false || 
                matches!(entity.entity_type, EntityType::Hero) ||
                matches!(entity.entity_type, EntityType::PressurePlate) ||
                matches!(entity.entity_type, EntityType::PushableObject) ||
                viewport.overlaps_or_touches(&entity.frame);

            if !is_visible {
                continue;
            }

            let item = Hittable {
                frame: entity.hittable_frame(),
                has_weight: entity.has_weight(),
                entity_id: entity.id, 
                species_id: entity.species_id,
                is_rigid: entity.is_rigid,
            };
            self.visible_entities.push((index, entity.id));
            self.hitmap.data.push(item);
        }

        let t = viewport.padded_all(-2.0);
        let min_x = t.x.floor().max(self.bounds.x) as usize;
        let max_x = t.max_x().min(self.bounds.max_x()).floor() as usize;
        let min_y = t.y.floor().max(self.bounds.y) as usize;
        let max_y = t.max_y().floor().min(self.bounds.max_y()) as usize;

        for y in min_y..max_y {
            for x in min_x..max_x {
                let item = self.biome_tiles.tiles.get_unchecked(y).get_unchecked(x).hittable; 
                if item.is_rigid {
                    self.tiles_hitmap.data.push(item);
                }

                let item = self.construction_tiles.tiles.get_unchecked(y).get_unchecked(x).hittable; 
                if item.is_rigid {
                    self.tiles_hitmap.data.push(item);
                }
            }
        }
    } 
}

impl Entity {
    fn has_weight(&self) -> bool {
        !matches!(self.entity_type, EntityType::PressurePlate | EntityType::Gate | EntityType::InverseGate | EntityType::WeaponMelee | EntityType::WeaponRanged)
    }
}

impl Hitmap {
    pub fn new() -> Self {
        Self {
            data: vec![]
        }
    }

    fn area_hits(&self, exclude: &[u32], area: &FRect) -> bool {
        for hittable in &self.data {
            if !hittable.is_rigid { continue }
            if exclude.contains(&hittable.entity_id) { continue }
            if hittable.frame.overlaps_or_touches(area) {
                return true
            }
        }
        false
    }

    fn hits_xy(&self, x: f32, y: f32) -> bool {
        self.hits_point(&Vector2d::new(x, y))
    }

    fn hits_point(&self, point: &Vector2d) -> bool {
        for hittable in &self.data {
            if !hittable.is_rigid { continue }
            if hittable.frame.contains_or_touches(point) {
                return true
            }
        }
        false
    }

    fn hits_line(&self, exclude: &[u32], start: &Vector2d, end: &Vector2d) -> bool {
        for hittable in &self.data {
            if !hittable.is_rigid { continue }
            if exclude.contains(&hittable.entity_id) { continue }
            if hittable.frame.intersects_line(start.x, start.y, end.x, end.y) {
                return true
            }
        }
        false
    }

    fn has_weight(&self, area: &FRect) -> bool {
        let area_center = area.center();

        for hittable in &self.data {
            if !hittable.has_weight { continue } 
            if hittable.frame.overlaps_or_touches(area) { return true }
            if hittable.frame.contains_or_touches(&area_center) || area.contains_or_touches(&hittable.frame.center()) {
                return true
            }
        }
        false
    }

    fn first_entity_id_by_area(&self, exclude: &[u32], area: &FRect) -> Option<Hittable> {
        for hittable in &self.data {
            if exclude.contains(&hittable.entity_id) { continue }
            if hittable.frame.overlaps_or_touches(area) {
                return Some(hittable.clone())
            }
        }
        None
    }

    fn entity_ids_by_area(&self, exclude: &[u32], area: &FRect) -> Vec<(EntityId, SpeciesId)> {
        self.data
            .iter()
            .filter_map(|hittable| {
                if exclude.contains(&hittable.entity_id) { 
                    return None 
                } else if hittable.frame.overlaps_or_touches(area) {
                    return Some((hittable.entity_id, hittable.species_id))
                } else {
                    None
                }
            })
            .collect()
    }

    fn ids_xy(&self, x: f32, y: f32) -> Vec<(EntityId, SpeciesId)> {
        self.ids_point(&Vector2d::new(x, y))
    }

    fn ids_point(&self, point: &Vector2d) -> Vec<(EntityId, SpeciesId)> {
        self.data.iter()
            .filter_map(|hittable| {
                if hittable.frame.contains_or_touches(point) {
                    Some((hittable.entity_id, hittable.species_id))
                } else {
                    None
                }
            })
            .collect()
    }
}