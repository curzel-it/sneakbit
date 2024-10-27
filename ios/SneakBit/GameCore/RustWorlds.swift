import Foundation

func fetchUpdatedTiles(
    forWorld worldId: UInt32,
    callback: @escaping (UInt32, [[BiomeTile]], [[ConstructionTile]]) -> Void
) {
    // Initialize pointers to receive data from Rust
    var biomeTilesPtr: UnsafePointer<BiomeTile>? = nil
    var constructionTilesPtr: UnsafePointer<ConstructionTile>? = nil
    var lenX: UInt = 0
    var lenY: UInt = 0

    // Call the Rust function to fetch updated tiles
    let currentRevision = updated_tiles(
        worldId,
        &biomeTilesPtr,
        &constructionTilesPtr,
        &lenX,
        &lenY
    )

    // Ensure that the pointers are not nil
    guard let biomePtr = biomeTilesPtr, let constructionPtr = constructionTilesPtr else {
        print("Failed to fetch updated tiles")
        return
    }

    // Calculate the total number of tiles
    let totalTiles = Int(lenX * lenY)

    // Create buffer pointers for biome tiles
    let biomeBuffer = UnsafeBufferPointer(start: biomePtr, count: totalTiles)
    let biomeArray = Array(biomeBuffer)

    // Create buffer pointers for construction tiles
    let constructionBuffer = UnsafeBufferPointer(start: constructionPtr, count: totalTiles)
    let constructionArray = Array(constructionBuffer)

    // Organize biome tiles into a 2D array
    var biome2D = [[BiomeTile]]()
    biome2D.reserveCapacity(Int(lenY))
    for y in 0..<Int(lenY) {
        let startIdx = y * Int(lenX)
        let endIdx = startIdx + Int(lenX)
        let row = Array(biomeArray[startIdx..<endIdx])
        biome2D.append(row)
    }

    // Organize construction tiles into a 2D array
    var construction2D = [[ConstructionTile]]()
    construction2D.reserveCapacity(Int(lenY))
    for y in 0..<Int(lenY) {
        let startIdx = y * Int(lenX)
        let endIdx = startIdx + Int(lenX)
        let row = Array(constructionArray[startIdx..<endIdx])
        construction2D.append(row)
    }

    // Invoke the callback with the fetched data
    callback(currentRevision, biome2D, construction2D)

    // Free the allocated memory to prevent memory leaks
    free_biome_tiles(UnsafeMutablePointer(mutating: biomePtr), lenX, lenY)
    free_construction_tiles(UnsafeMutablePointer(mutating: constructionPtr), lenX, lenY)
}
