use crate::constants::TILE_SIZE;

pub struct MouseEventsProvider {
    pub is_left_down: bool,
    pub is_right_down: bool,
    pub has_left_been_pressed: bool,
    pub has_right_been_pressed: bool,
    pub x: i32,
    pub y: i32,
    pub has_moved: bool,
}

impl MouseEventsProvider {
    pub const fn new() -> Self {
        Self {            
            is_left_down: false,
            is_right_down: false,
            has_left_been_pressed: false,
            has_right_been_pressed: false,
            x: 0, 
            y: 0,
            has_moved: false
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self, 
        mouse_left_down: bool, 
        mouse_left_pressed: bool, 
        mouse_right_down: bool,
        mouse_right_pressed: bool, 
        mouse_x: f32,
        mouse_y: f32,
        rendering_scale: f32
    ) {
        self.is_left_down = mouse_left_down;
        self.is_right_down = mouse_right_down;
        self.has_left_been_pressed = mouse_left_pressed;
        self.has_right_been_pressed = mouse_right_pressed;

        let new_x = (mouse_x / (rendering_scale * TILE_SIZE)) as i32;
        let new_y = (mouse_y / (rendering_scale * TILE_SIZE)) as i32;
        
        self.has_moved = new_x != self.x || new_y != self.y;
        self.x = new_x;
        self.y = new_y;
    }

    pub fn on_world_changed(&mut self) {
        self.has_left_been_pressed = false;
        self.has_right_been_pressed = false;
        self.has_moved = false;
    } 
}