import Foundation

func fetchBiomeTiles(_ callback: @escaping ([[BiomeTile]]) -> Void) {
    var tilesPtr: UnsafePointer<BiomeTile>?
    var lenX: UInt = 0
    var lenY: UInt = 0

    get_biome_tiles(&tilesPtr, &lenX, &lenY)

    guard let tilesPtr = tilesPtr else {
        print("Failed to fetch biome tiles")
        return
    }

    let totalTiles = Int(lenX * lenY)
    let buffer = UnsafeBufferPointer(start: tilesPtr, count: totalTiles)
    let tilesArray = Array(buffer)

    var tiles2D = [[BiomeTile]]()
    tiles2D.reserveCapacity(Int(lenY))

    for y in 0..<Int(lenY) {
        let startIdx = y * Int(lenX)
        let endIdx = startIdx + Int(lenX)
        let row = Array(tilesArray[startIdx..<endIdx])
        tiles2D.append(row)
    }
    
    callback(tiles2D)
    free_biome_tiles(UnsafeMutablePointer(mutating: tilesPtr), lenX, lenY)
}
