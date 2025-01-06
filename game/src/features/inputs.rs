use game_core::{current_keyboard_state, input::keyboard_events_provider::KeyboardEventsProvider, is_turn_prep, number_of_players, update_keyboard, update_mouse};
use raylib::prelude::*;

use crate::GameContext;

pub fn handle_mouse_updates(rl: &mut RaylibHandle, rendering_scale: f32) {
    update_mouse(
        rl.is_mouse_button_down(MouseButton::MOUSE_BUTTON_LEFT), 
        rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_LEFT), 
        rl.is_mouse_button_down(MouseButton::MOUSE_BUTTON_RIGHT), 
        rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_RIGHT), 
        rl.get_mouse_position().x,
        rl.get_mouse_position().y, 
        rendering_scale
    );
}

pub fn handle_keyboard_updates(context: &mut GameContext, time_since_last_update: f32) {
    if is_turn_prep() {
        return
    }
    let previous_keyboard_state = current_keyboard_state();
    let number_of_players = number_of_players();

    let has_controller_now = context.rl.is_gamepad_available(0);
    let controller_availability_changed = context.total_run_time > 0.5 && (context.using_controller != has_controller_now);  
    let lost_focus = false; // !context.rl.is_window_focused();
    let should_pause = controller_availability_changed || (lost_focus && !context.debug);

    if controller_availability_changed {        
        if has_controller_now {
            context.rl.hide_cursor();
        } else {
            context.rl.show_cursor();
        }
    }
    context.using_controller = has_controller_now;

    update_keyboard_for_primary_player(&mut context.rl, should_pause, previous_keyboard_state, time_since_last_update);

    if number_of_players > 1 {
        update_keyboard_for_secondary_player(&mut context.rl, previous_keyboard_state, time_since_last_update, 1, 1);
    }
    if number_of_players > 2 {
        update_keyboard_for_secondary_player(&mut context.rl, previous_keyboard_state, time_since_last_update, 2, 2);
    }
    if number_of_players > 3 {
        update_keyboard_for_secondary_player(&mut context.rl, previous_keyboard_state, time_since_last_update, 3, 3);
    }
}

fn update_keyboard_for_primary_player(rl: &mut RaylibHandle, should_pause: bool, previous_keyboard_state: &KeyboardEventsProvider, time_since_last_update: f32) {
    let player: usize = 0;
    let gamepad: i32 = 0;

    let (joystick_up, joystick_right, joystick_down, joystick_left) = current_joystick_directions(rl, 0);

    let was_up_down = previous_keyboard_state.is_direction_up_down(player);
    let was_right_down = previous_keyboard_state.is_direction_right_down(player);
    let was_down_down = previous_keyboard_state.is_direction_down_down(player);
    let was_left_down = previous_keyboard_state.is_direction_left_down(player);

    update_keyboard(
        0,
        rl.is_key_pressed(KeyboardKey::KEY_W) || rl.is_key_pressed(KeyboardKey::KEY_UP) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!was_up_down && joystick_up), 
        rl.is_key_pressed(KeyboardKey::KEY_D) || rl.is_key_pressed(KeyboardKey::KEY_RIGHT) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!was_right_down && joystick_right), 
        rl.is_key_pressed(KeyboardKey::KEY_S) || rl.is_key_pressed(KeyboardKey::KEY_DOWN) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!was_down_down && joystick_down), 
        rl.is_key_pressed(KeyboardKey::KEY_A) || rl.is_key_pressed(KeyboardKey::KEY_LEFT) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!was_left_down && joystick_left), 
        rl.is_key_down(KeyboardKey::KEY_W) || rl.is_key_down(KeyboardKey::KEY_UP) || rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
        rl.is_key_down(KeyboardKey::KEY_D) || rl.is_key_down(KeyboardKey::KEY_RIGHT) || rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
        rl.is_key_down(KeyboardKey::KEY_S) || rl.is_key_down(KeyboardKey::KEY_DOWN) || rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
        rl.is_key_down(KeyboardKey::KEY_A) || rl.is_key_down(KeyboardKey::KEY_LEFT) || rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
        rl.is_key_pressed(KeyboardKey::KEY_ESCAPE) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
        should_pause || rl.is_key_pressed(KeyboardKey::KEY_X) || rl.is_key_pressed(KeyboardKey::KEY_ENTER) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_E) || rl.is_key_pressed(KeyboardKey::KEY_K) || rl.is_key_pressed(KeyboardKey::KEY_SPACE) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
        rl.is_key_pressed(KeyboardKey::KEY_R) || rl.is_key_pressed(KeyboardKey::KEY_Q) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_F) || rl.is_key_pressed(KeyboardKey::KEY_J) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
        rl.is_key_pressed(KeyboardKey::KEY_TAB) || rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_UP),
        rl.is_key_pressed(KeyboardKey::KEY_BACKSPACE), 
        time_since_last_update
    );
}

fn update_keyboard_for_secondary_player(rl: &mut RaylibHandle, previous_keyboard_state: &KeyboardEventsProvider, time_since_last_update: f32, player: usize, gamepad: i32) {
    if !rl.is_gamepad_available(gamepad) {
        return
    }
    let (joystick_up, joystick_right, joystick_down, joystick_left) = current_joystick_directions(rl, gamepad);

    let was_up_down = previous_keyboard_state.is_direction_up_down(player);
    let was_right_down = previous_keyboard_state.is_direction_right_down(player);
    let was_down_down = previous_keyboard_state.is_direction_down_down(player);
    let was_left_down = previous_keyboard_state.is_direction_left_down(player);

    update_keyboard(
        player,
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!was_up_down && joystick_up), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!was_right_down && joystick_right), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!was_down_down && joystick_down), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!was_left_down && joystick_left), 
        rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
        rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
        rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
        rl.is_gamepad_button_down(gamepad, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_LEFT), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
        rl.is_gamepad_button_pressed(gamepad, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_UP),
        false,
        time_since_last_update
    );
}

fn current_joystick_directions(rl: &RaylibHandle, gamepad: i32) -> (bool, bool, bool, bool) {
    let left_x = rl.get_gamepad_axis_movement(gamepad, GamepadAxis::GAMEPAD_AXIS_LEFT_X);
    let left_y = rl.get_gamepad_axis_movement(gamepad, GamepadAxis::GAMEPAD_AXIS_LEFT_Y);
    
    let threshold = 0.5;
    
    let (joystick_up, joystick_down) = if left_y.abs() >= left_x.abs() {
        if left_y < -threshold {
            (true, false)
        } else if left_y > threshold {
            (false, true)
        } else {
            (false, false)
        }
    } else {
        (false, false)
    };
    
    let (joystick_right, joystick_left) = if left_y.abs() < left_x.abs() {
        if left_x > threshold {
            (true, false)
        } else if left_x < -threshold {
            (false, true)
        } else {
            (false, false)
        }
    } else {
        (false, false)
    };

    (joystick_up, joystick_right, joystick_down, joystick_left)
}