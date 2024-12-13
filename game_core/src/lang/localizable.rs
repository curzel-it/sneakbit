use std::collections::HashMap;
use std::fs;
use std::path::Path;
use lazy_static::lazy_static;

use crate::config::config;
use crate::game_engine::storage::{get_value_for_global_key, StorageKey};

pub trait LocalizableText {
    fn try_localize(&self) -> Option<String>;
    fn localized(&self) -> String; 
}

impl LocalizableText for String {
    fn try_localize(&self) -> Option<String> {
        if let Some(strings) = LOCALIZED_STRINGS.get(language().as_str()) {
            if let Some(localized_string) = strings.get(self) {
                return Some(localized_string.clone());
            }
        }
        None
    }

    fn localized(&self) -> String {
        if config().is_mobile {
            let key = format!("{}.mobile", self);

            if let Some(mobile_text) = key.try_localize() {
                return mobile_text
            }
        }
        return self.try_localize().unwrap_or(self.clone())
    }
}

impl LocalizableText for &str {
    fn try_localize(&self) -> Option<String> {
        self.to_string().try_localize()
    }

    fn localized(&self) -> String {
        self.to_string().localized()
    }
}

lazy_static! {
    pub static ref LOCALIZED_STRINGS: HashMap<String, HashMap<String, String>> = load_localized_strings();
}

pub const LANG_EN: &str = "en";
pub const LANG_IT: &str = "it";

fn language() -> String {
    match get_value_for_global_key(&StorageKey::language()).unwrap_or(0) {
        1 => LANG_EN.to_owned(),
        2 => LANG_IT.to_owned(),
        _ => config().current_lang.clone()
    }
}

fn load_localized_strings() -> HashMap<String, HashMap<String, String>> {
    let mut localized_strings = HashMap::new();    
    println!("Lang folder: {:#?}", config().localized_strings_path.clone());
    let paths = fs::read_dir(config().localized_strings_path.clone())
        .expect("Failed to read localized strings")
        .flatten()
        .map(|p| p.path());

    for file_path in paths {        
        if file_path.extension() == Some(std::ffi::OsStr::new("stringx")) {
            if let Some(locale) = file_path.file_stem().and_then(|os_str| os_str.to_str()) {
                let strings = load_strings_from_file(&file_path);
                localized_strings.insert(locale.to_string(), strings);
            }
        }
    }
    localized_strings
}

fn load_strings_from_file(file_path: &Path) -> HashMap<String, String> {
    let content = fs::read_to_string(file_path)
        .unwrap_or_else(|_| panic!("Failed to read localization file: {:?}", file_path));
    parse_strings_content(&content)
}

fn parse_strings_content(content: &str) -> HashMap<String, String> {
    let mut strings_map = HashMap::new();
    let mut pos = 0;
    let content_chars: Vec<char> = content.chars().collect();
    let len = content.len().min(content_chars.len());

    while pos < len {
        skip_whitespace(&content_chars, &mut pos);

        if pos >= len {
            break;
        }

        if content_chars[pos] == '"' {
            let key = parse_string(&content_chars, &mut pos);
            skip_whitespace(&content_chars, &mut pos);

            if pos >= len || content_chars[pos] != '=' {
                panic!("Expected '=' after key at position {}", pos);
            }
            pos += 1; 

            skip_whitespace(&content_chars, &mut pos);

            let value = if content_chars[pos] == '"' {
                if pos + 2 < len && content_chars[pos + 1] == '"' && content_chars[pos + 2] == '"' {
                    parse_multiline_string(&content_chars, &mut pos)
                } else {
                    parse_string(&content_chars, &mut pos)
                }
            } else {
                panic!("Expected '\"' at position {}", pos);
            };

            strings_map.insert(key, cleaned(value));
        } else {
            panic!("Expected '\"' at position {}", pos);
        }
    }

    strings_map
}

fn cleaned(original: String) -> String {
    original
        .replace("…", "...")
        .replace("’", "'")
        .replace("—", "-")        
        .replace("\r\n", "\n")
}

fn skip_whitespace(chars: &[char], pos: &mut usize) {
    while *pos < chars.len() && chars[*pos].is_whitespace() {
        *pos += 1;
    }
}

fn parse_string(chars: &[char], pos: &mut usize) -> String {
    if chars[*pos] != '"' {
        panic!("Expected '\"' at position {}", pos);
    }
    *pos += 1; 

    let mut result = String::new();
    while *pos < chars.len() {
        let c = chars[*pos];
        if c == '"' {
            *pos += 1; 
            return result;
        } else if c == '\\' {
            *pos += 1;
            if *pos >= chars.len() {
                panic!("Unexpected end of input after escape character at position {}", pos);
            }
            let escaped_char = chars[*pos];
            match escaped_char {
                'n' => result.push('\n'),
                't' => result.push('\t'),
                '\\' => result.push('\\'),
                '"' => result.push('"'),
                _ => result.push(escaped_char),
            }
        } else {
            result.push(c);
        }
        *pos += 1;
    }
    panic!("Unterminated string starting at position {}", pos);
}

fn parse_multiline_string(chars: &[char], pos: &mut usize) -> String {
    if *pos + 2 >= chars.len() || chars[*pos] != '"' || chars[*pos + 1] != '"' || chars[*pos + 2] != '"' {
        panic!("Expected '\"\"\"' at position {}", pos);
    }
    *pos += 3;

    if *pos < chars.len() && chars[*pos] == '\n' {
        *pos += 1;
    }

    let mut result = String::new();
    while *pos + 2 < chars.len() {
        if chars[*pos] == '"' && chars[*pos + 1] == '"' && chars[*pos + 2] == '"' {
            *pos += 3;
            if result.ends_with('\n') {
                result.pop();
            }
            return result;
        } else {
            result.push(chars[*pos]);
            *pos += 1;
        }
    }
    panic!("Unterminated multiline string starting at position {}", pos);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_strings_content_single_line() {
        let content = r#"
"key1" = "value1"
"key2" = "value2"
"#;

        let parsed = parse_strings_content(content);
        assert_eq!(parsed.get("key1").unwrap(), "value1");
        assert_eq!(parsed.get("key2").unwrap(), "value2");
    }

    #[test]
    fn test_parse_strings_content_multiline() {
        let content = r#"
"multiline.key" = """
Line1
Line2
Line3
"""
"#;

        let parsed = parse_strings_content(content);
        assert_eq!(
            parsed.get("multiline.key").unwrap(),
            "Line1\nLine2\nLine3"
        );
    }

    #[test]
    fn test_parse_strings_content_sample() {
        let content = r#"
"example" = "value"
"multiline.example" = """
Some 
multiline 
value
"""

"some other example" = "some other value"
"#;

        let parsed = parse_strings_content(content);
        assert_eq!(parsed.get("example").unwrap(), "value");
        assert_eq!(parsed.get("some other example").unwrap(), "some other value");
        assert_eq!(
            parsed.get("multiline.example").unwrap(),
            "Some \nmultiline \nvalue"
        );
    }

    #[test]
    #[should_panic(expected = "Expected '=' after key")]
    fn test_parse_strings_content_missing_equal() {
        let content = r#"
"key1"  "value1"
"#;

        parse_strings_content(content);
    }

    #[test]
    #[should_panic(expected = "Unterminated string")]
    fn test_parse_strings_content_unterminated_string() {
        let content = r#"
"key1" = "value1
"#;

        parse_strings_content(content);
    }

    #[test]
    #[should_panic(expected = "Expected '\"' at position")]
    fn test_parse_strings_content_invalid_start() {
        let content = r#"
key1 = "value1"
"#;

        parse_strings_content(content);
    }
}
