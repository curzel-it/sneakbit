use game_core::features::links::LinksHandler;

pub struct MyLinkHandler;

impl LinksHandler for MyLinkHandler {
    fn open(&self, link: &str) {
        let _ = open::that(link);
    }
}

