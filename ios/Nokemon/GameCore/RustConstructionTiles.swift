import Foundation
 
func fetchConstructionTiles(_ callback: @escaping ([[ConstructionTile]]) -> Void) {
    var tilesPtr: UnsafePointer<ConstructionTile>?
    var lenX: UInt = 0
    var lenY: UInt = 0

    get_construction_tiles(&tilesPtr, &lenX, &lenY)

    guard let tilesPtr = tilesPtr else {
        print("Failed to fetch construction tiles")
        return
    }

    let totalTiles = Int(lenX * lenY)
    let buffer = UnsafeBufferPointer(start: tilesPtr, count: totalTiles)
    let tilesArray = Array(buffer)

    var tiles2D = [[ConstructionTile]]()
    tiles2D.reserveCapacity(Int(lenY))

    for y in 0..<Int(lenY) {
        let startIdx = y * Int(lenX)
        let endIdx = startIdx + Int(lenX)
        let row = Array(tilesArray[startIdx..<endIdx])
        tiles2D.append(row)
    }
    
    callback(tiles2D)
    free_construction_tiles(UnsafeMutablePointer(mutating: tilesPtr), lenX, lenY)
}
