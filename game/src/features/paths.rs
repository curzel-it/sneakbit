use std::{env, path::PathBuf};

pub fn local_path(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push(filename);
    path
}

pub fn root_path() -> PathBuf {
    let cargo_manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let exe_path = env::current_exe().unwrap_or(cargo_manifest_path);
    let exe_str = exe_path.to_str().unwrap();
    let base = exe_str
        .replace("target/debug/game", "game")
        .replace("target/release/game", "game")
        .replace("target\\debug\\game", "game")
        .replace("target\\release\\game", "game");

    let path = PathBuf::from(base);
    let mut components = path.components();
    components.next_back();
    components.as_path().to_path_buf()
}