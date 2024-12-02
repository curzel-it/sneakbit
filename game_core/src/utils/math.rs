pub fn are_equal(first: f32, second: f32) -> bool {
    (first - second).abs() < 0.0001
}