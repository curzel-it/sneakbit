use super::paths::local_path;

pub fn regular_font_path() -> String {
    let mut path = local_path("fonts");
    path.push("PixelOperator");
    path.push("PixelOperator8.ttf");
    path.as_os_str().to_str().unwrap().to_owned()
}

pub fn bold_font_path() -> String {
    let mut path = local_path("fonts");
    path.push("PixelOperator");
    path.push("PixelOperator8-Bold.ttf");
    path.as_os_str().to_str().unwrap().to_owned()
}

pub fn latin_characters() -> String {
    // Collect characters from the Latin Unicode blocks
    let mut latin_chars = String::new();

    // Basic Latin (U+0020 to U+007F)
    for c in 0x0020..=0x007F {
        latin_chars.push(char::from_u32(c).unwrap());
    }

    // Latin-1 Supplement (U+00A0 to U+00FF)
    for c in 0x00A0..=0x00FF {
        latin_chars.push(char::from_u32(c).unwrap());
    }

    // Latin Extended-A (U+0100 to U+017F)
    for c in 0x0100..=0x017F {
        latin_chars.push(char::from_u32(c).unwrap());
    }

    // Latin Extended-B (U+0180 to U+024F)
    for c in 0x0180..=0x024F {
        latin_chars.push(char::from_u32(c).unwrap());
    }

    // Latin Extended Additional (U+1E00 to U+1EFF)
    for c in 0x1E00..=0x1EFF {
        latin_chars.push(char::from_u32(c).unwrap());
    }

    latin_chars
}
