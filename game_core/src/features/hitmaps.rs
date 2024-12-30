use crate::{entities::species::{EntityType, SpeciesId}, features::entity::{Entity, EntityId}, utils::{rect::FRect, vector::Vector2d}, worlds::world::World};

#[derive(Clone)]
pub struct Hitmap {
    pub data: Vec<Hittable>
}

#[derive(Clone)]
pub struct Hittable {
    pub frame: FRect,
    pub weight: i32,
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
                let item = Hittable {
                    frame: entity.hittable_frame(),
                    weight: if entity.has_weight() { 1 } else { 0 },
                    entity_id: entity.id, 
                    species_id: entity.species_id,
                    is_rigid: entity.is_rigid,
                };
                self.hitmap.data.push(item);
            }
        }
    } 

    pub fn update_tiles_hitmap(&mut self) {
        self.tiles_hitmap.data.clear();

        for y in 0..self.biome_tiles.tiles.len() {
            for x in 0..self.biome_tiles.tiles[0].len() {
                if self.biome_tiles.tiles[y][x].is_obstacle() {
                    let frame = FRect::new(
                        x as f32 + 0.15, 
                        y as f32 + 0.15, 
                        0.7, 
                        0.7
                    );
                    let item = Hittable {
                        frame,
                        weight: 0,
                        entity_id: 0, 
                        species_id: 0,
                        is_rigid: true,
                    };
                    self.tiles_hitmap.data.push(item);
                } else {
                    let construction_tile = self.construction_tiles.tiles[y][x];

                    if construction_tile.is_obstacle() {
                        let geometry_texture_index = construction_tile.texture_source_rect.y.floor() as i32;

                        let (top, right, bottom, left) = match geometry_texture_index {
                            0 => (0.25, 0.0, 0.0, 0.0), // top side
                            1 => (0.15, 0.15, 0.15, 0.15), // single
                            2 => (0.25, 0.25, 0.0, 0.0), // top right corner
                            3 => (0.25, 0.0, 0.0, 0.25), // top left corner
                            4 => (0.0, 0.25, 0.0, 0.25), // middle pillar, no sides
                            5 => (0.0, 0.25, 0.25, 0.25), // bottom pillar
                            6 => (0.25, 0.25, 0.0, 0.25), // top pillar
                            7 => (0.0, 0.0, 0.25, 0.25), // bottom left corner
                            8 => (0.0, 0.25, 0.25, 0.0), // bottom right corner
                            9 => (0.25, 0.0, 0.0, 0.25), // top left corner
                            10 => (0.25, 0.25, 0.0, 0.0), // top right corner
                            11 => (0.0, 0.0, 0.0, 0.25), // left side
                            12 => (0.0, 0.25, 0.0, 0.0), // right side
                            13 => (0.0, 0.0, 0.25, 0.0), // bottom side
                            14 => (0.25, 0.0, 0.0, 0.0), // top side
                            15 => (0.0, 0.0, 0.0, 0.0), // center cross
                            _ => (0.15, 0.15, 0.15, 0.15)
                        };

                        let frame = FRect::new(
                            x as f32 + left, 
                            y as f32 + top, 
                            1.0 - left - right, 
                            1.0 - top - bottom
                        );
                        let item = Hittable {
                            frame,
                            weight: 0,
                            entity_id: 0, 
                            species_id: 0,
                            is_rigid: true,
                        };
                        self.tiles_hitmap.data.push(item);
                    }
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
        self.data.iter().any(|hittable| {            
            hittable.is_rigid && !exclude.contains(&hittable.entity_id) && hittable.frame.overlaps_or_touches(area)
        })
    }

    fn hits_xy(&self, x: f32, y: f32) -> bool {
        self.hits_point(&Vector2d::new(x, y))
    }

    fn hits_point(&self, point: &Vector2d) -> bool {
        self.data.iter().any(|hittable| {
            hittable.is_rigid && hittable.frame.contains_or_touches(point)
        })
    }

    fn hits_line(&self, exclude: &[u32], start: &Vector2d, end: &Vector2d) -> bool {
        self.data
            .iter()
            .any(|hittable| {
                if !hittable.is_rigid { return false }
                if exclude.contains(&hittable.entity_id) { return false }
                hittable.frame.intersects_line(start.x, start.y, end.x, end.y)
            })
    }

    fn has_weight_xy(&self, x: f32, y: f32) -> bool {
        self.has_weight_point(&Vector2d::new(x, y))
    }

    fn has_weight_point(&self, point: &Vector2d) -> bool {
        self.data.iter().any(|hittable| {
            hittable.weight > 0 && hittable.frame.contains_or_touches(point)
        })
    }

    fn first_entity_id_by_area(&self, exclude: &[u32], area: &FRect) -> Option<Hittable> {
        self.data
            .iter()
            .find(|hittable| {
                !exclude.contains(&hittable.entity_id) && hittable.frame.overlaps_or_touches(area)
            })
            .cloned()
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