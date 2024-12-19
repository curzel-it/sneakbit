use std::ffi::{CStr, CString};
use std::os::raw::c_char;

pub fn wrap_text(input: &str, max_length: usize) -> Vec<String> {
    input
        .split_terminator("\n")
        .flat_map(|line| wrap_line(line, max_length))
        .collect()
}

fn wrap_line(input: &str, max_length: usize) -> Vec<String> {
    let mut result: Vec<String> = vec![];
    let mut current_line = String::new();

    for word in input.split_whitespace() {
        let potential_length = current_line.len() + 1 + word.len();
        if potential_length <= max_length {
            current_line.push(' ');
            current_line.push_str(word);
        } else {
            result.push(current_line);
            current_line = word.to_string();
        }
    }
    result.push(current_line);
    
    result.iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_owned())
        .collect()
}


pub fn c_char_ptr_to_string(value: *const c_char) -> String {
    if value.is_null() {
        return String::new();
    }

    unsafe {
        CStr::from_ptr(value)
            .to_str()
            .unwrap_or_default()
            .to_owned()
    }
}

pub fn string_to_c_char(s: String) -> *const c_char {
    let c_string = CString::new(s).expect("Failed to convert String to CString");
    let raw_ptr = c_string.into_raw();
    raw_ptr as *const c_char
}

pub fn str_to_c_char(s: &str) -> *const c_char {
    let c_string = CString::new(s).expect("Failed to convert String to CString");
    let raw_ptr = c_string.into_raw();
    raw_ptr as *const c_char
}