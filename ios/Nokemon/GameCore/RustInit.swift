import Foundation

func initializeEngine() {
    initialize_config(
        currentLang(),
        dataFolder(),
        speciesJson(),
        inventoryJson(),
        saveJson(),
        langFolder()
    )
    initialize_game(false)
}
/*
func testRustIntegration() {
    test_integration()
    
    initialize_config(
        currentLang(),
        dataFolder(),
        speciesJson(),
        inventoryJson(),
        saveJson(),
        langFolder()
    )
    initialize_game(false)
    
    window_size_changed(400, 400, 1, 1, 1)
    update_game(0.1)
    
    fetchRenderableItems { renderableItems in
        for item in renderableItems {
            print("Sprite Sheet ID: \(item.sprite_sheet_id)")
            print("Texture Rect: (x: \(item.texture_rect.x), y: \(item.texture_rect.y), width: \(item.texture_rect.width), height: \(item.texture_rect.height))")
            print("Offset: (x: \(item.offset.x), y: \(item.offset.y))")
            print("Frame: (x: \(item.frame.x), y: \(item.frame.y), width: \(item.frame.width), height: \(item.frame.height))")
        }
    }
    
    fetchBiomeTiles { tiles in
        for y in 0..<tiles.count {
            for x in 0..<tiles[y].count {
                print("y \(y) x \(x) \(tiles[y][x].tile_type)")
            }
        }
    }
}
*/
