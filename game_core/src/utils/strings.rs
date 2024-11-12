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
