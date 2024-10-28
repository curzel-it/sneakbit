import Foundation

func fetchUpdatedTiles(
    forWorld worldId: UInt32,
    callback: @escaping (UInt32, [[BiomeTile]], [[ConstructionTile]]) -> Void
) {
    var biomeTilesPtr: UnsafePointer<BiomeTile>? = nil
    var constructionTilesPtr: UnsafePointer<ConstructionTile>? = nil
    var lenX: UInt = 0
    var lenY: UInt = 0

    let currentRevision = updated_tiles(
        worldId,
        &biomeTilesPtr,
        &constructionTilesPtr,
        &lenX,
        &lenY
    )

    guard let biomePtr = biomeTilesPtr, let constructionPtr = constructionTilesPtr else {
        print("Failed to fetch updated tiles")
        return
    }

    let totalTiles = Int(lenX * lenY)
    let biomeBuffer = UnsafeBufferPointer(start: biomePtr, count: totalTiles)
    let biomeArray = Array(biomeBuffer)
    let constructionBuffer = UnsafeBufferPointer(start: constructionPtr, count: totalTiles)
    let constructionArray = Array(constructionBuffer)

    var biome2D = [[BiomeTile]]()
    biome2D.reserveCapacity(Int(lenY))
    for y in 0..<Int(lenY) {
        let startIdx = y * Int(lenX)
        let endIdx = startIdx + Int(lenX)
        let row = Array(biomeArray[startIdx..<endIdx])
        biome2D.append(row)
    }

    var construction2D = [[ConstructionTile]]()
    construction2D.reserveCapacity(Int(lenY))
    for y in 0..<Int(lenY) {
        let startIdx = y * Int(lenX)
        let endIdx = startIdx + Int(lenX)
        let row = Array(constructionArray[startIdx..<endIdx])
        construction2D.append(row)
    }

    callback(currentRevision, biome2D, construction2D)
    free_biome_tiles(UnsafeMutablePointer(mutating: biomePtr), lenX, lenY)
    free_construction_tiles(UnsafeMutablePointer(mutating: constructionPtr), lenX, lenY)
}
