use std::cmp::Ordering;

use raylib::math::Vector2;
/*
#[derive(Debug)]
pub struct EntityLocator {}

impl EntityLocator {
    pub fn new() -> Self {
        EntityLocator {}
    }

    pub fn sorted_by_nearest(&self, origin: Vector2, items: &Vec<EntityStateSnapshot>) -> Vec<EntityStateSnapshot> {
        let mut sorted = items.clone();
        self.sort_by_nearest(origin, &mut sorted);
        return sorted;
    }

    pub fn sort_by_nearest(&self, origin: Vector2, items: &mut Vec<EntityStateSnapshot>) {
        items.sort_by(|a, b| {
            let center_a = Vector2::new(
                a.frame.x + a.frame.width / 2.0, 
                a.frame.y + a.frame.height / 2.0
            );
            let center_b = Vector2::new(
                b.frame.x + b.frame.width / 2.0, 
                b.frame.y + b.frame.height / 2.0
            );
            let dist_a = origin.distance_to(center_a);
            let dist_b = origin.distance_to(center_b);
    
            dist_a.partial_cmp(&dist_b).unwrap_or(Ordering::Equal)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_return_sorted_list() {
        let mut entities = vec![
            EntityStateSnapshot::with_id_and_x(0, 100.0), 
            EntityStateSnapshot::with_id_and_x(1,  50.0), 
            EntityStateSnapshot::with_id_and_x(2,  10.0)
        ];

        let origin = Vector2::new(0.0, 0.0);
        let locator = EntityLocator::new();
        locator.sort_by_nearest(origin, &mut entities);

        let results: Vec<u32> = entities.iter().map(|e| e.id).collect();
        assert_eq!(results, vec![2, 1, 0]);
    }
} */