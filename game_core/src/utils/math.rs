const EPSILON: f32 = 0.001;

pub fn are_equal(first: f32, second: f32) -> bool {
    (first - second).abs() < 0.0001
}

pub trait ZeroComparable {
    fn is_zero(&self) -> bool; 
    fn is_close_to_int(&self) -> bool; 
}

impl ZeroComparable for f32 {
    fn is_zero(&self) -> bool {
        self.abs() < EPSILON
    }

    fn is_close_to_int(&self) -> bool {
        (100.0 * self.abs()).floor() < EPSILON
    }
}