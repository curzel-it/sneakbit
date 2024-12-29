use crate::{entities::species::{EntityType, SpeciesId}, features::entity::{Entity, EntityId}, utils::{rect::FRect, vector::Vector2d}, worlds::world::World};

#[derive(Clone)]
pub struct Hitmap {
    data: Vec<Hittable>
}

pub type Hittable = (FRect, i32, EntityId, SpeciesId);

impl World {    
    pub fn area_hits(&self, myid: &u32, area: &FRect) -> bool {
        self.hitmap.area_hits(myid, area) || self.tiles_hitmap.area_hits(myid, area)
    }
    
    pub fn hits(&self, x: f32, y: f32) -> bool {
        self.hitmap.hits_xy(x, y) || self.tiles_hitmap.hits_xy(x, y) 
    }

    pub fn hits_or_out_of_bounds(&self, x: f32, y: f32) -> bool {
        x < 0.0 || y < 0.0 || x >= self.bounds.max_x() || y >= self.bounds.max_y() || self.hits(x, y)
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

    pub fn has_weight(&self, x: f32, y: f32) -> bool {
        if x < 0.0 || y < 0.0 || y >= self.bounds.h || x >= self.bounds.w { 
            false 
        } else { 
            self.hitmap.has_weight_xy(x, y)
        }
    }

    pub fn update_hitmaps(&mut self) {
        self.hitmap.data.clear();

        let entities = &self.entities.borrow();

        for &(index, _) in &self.visible_entities {
            if let Some(entity) = entities.get(index) {
                if entity.is_rigid {
                    let item = (
                        entity.hittable_frame(),
                        if entity.has_weight() { 1 } else { 0 },
                        entity.id, 
                        entity.species_id
                    );
                    self.hitmap.data.push(item);
                }
            }
        }
    } 

    pub fn update_tiles_hitmap(&mut self) {
        self.tiles_hitmap.data.clear();

        for y in 0..self.biome_tiles.tiles.len() {
            for x in 0..self.biome_tiles.tiles[0].len() {
                let biome_obstacle = self.biome_tiles.tiles[y][x].is_obstacle();
                let construction_obstacle = self.construction_tiles.tiles[y][x].is_obstacle();

                if biome_obstacle || construction_obstacle {
                    let frame = FRect::new(x as f32 + 0.15, y as f32 + 0.15, 0.7, 0.7);
                    let item = (frame, 0, 0, 0);
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

    fn area_hits(&self, myid: &u32, area: &FRect) -> bool {
        self.data.iter().any(|(other, _, entity_id, species_id)| {            
            if entity_id != myid && other.overlaps_or_touches(area) {
                println!("> Collision with {} {} between {:#?} and {:#?}", entity_id, species_id, area, other);
                true
            } else {
                false
            }
        })
    }

    fn hits_xy(&self, x: f32, y: f32) -> bool {
        self.hits_point(&Vector2d::new(x, y))
    }

    fn hits_point(&self, point: &Vector2d) -> bool {
        self.data.iter().any(|(other, _, _, _)| {
            other.contains_or_touches(point)
        })
    }

    fn has_weight_xy(&self, x: f32, y: f32) -> bool {
        self.has_weight_point(&Vector2d::new(x, y))
    }

    fn has_weight_point(&self, point: &Vector2d) -> bool {
        self.data.iter().any(|(other, weight, _, _)| {
            *weight > 0 && other.contains_or_touches(point)
        })
    }

    fn first_entity_id_by_area(&self, exclude: &[u32], area: &FRect) -> Option<Hittable> {
        self.data
            .iter()
            .find(|(other, _, entity_id, _)| {
                !exclude.contains(entity_id) && area.overlaps_or_touches(other)
            })
            .cloned()
    }

    fn entity_ids_by_area(&self, exclude: &[u32], area: &FRect) -> Vec<(EntityId, SpeciesId)> {
        self.data
            .iter()
            .filter_map(|(other, _, entity_id, species_id)| {
                if exclude.contains(entity_id) { 
                    return None 
                } else if area.overlaps_or_touches(other) {
                    return Some((*entity_id, *species_id))
                } else {
                    None
                }
            })
            .collect()
    }

    fn ids_xy(&self, x: f32, y: f32) -> Vec<(EntityId, SpeciesId)> {
        self.ids_point(&Vector2d::new(x, y))
    }

    fn ids_rect(&self, rect: &FRect) -> Vec<(EntityId, SpeciesId)> {
        self.data.iter()
            .filter(|(other, _, _, _)| other.overlaps_or_touches(rect))
            .map(|(_, _, entity_id, species_id)| (*entity_id, *species_id))
            .collect()
    }

    fn ids_point(&self, point: &Vector2d) -> Vec<(EntityId, SpeciesId)> {
        self.data.iter()
            .filter(|(other, _, _, _)| other.contains_or_touches(point))
            .map(|(_, _, entity_id, species_id)| (*entity_id, *species_id))
            .collect()
    }
}