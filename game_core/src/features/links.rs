pub trait LinksHandler {
    fn open(&self, link: &str);
}

pub struct NoLinksHandler;

impl NoLinksHandler {
    pub fn new() -> Self {
        Self {}
    }
}

impl LinksHandler for NoLinksHandler {
    fn open(&self, _: &str) {
        // ..
    }
}