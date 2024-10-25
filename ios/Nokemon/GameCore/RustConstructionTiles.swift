import Foundation
public typealias Construction = UInt32

@frozen
public struct ConstructionTile {
    public var tile_type: Construction
    public var tile_up_type: Construction
    public var tile_right_type: Construction
    public var tile_down_type: Construction
    public var tile_left_type: Construction
    public var texture_source_rect: IntRect
}

@_silgen_name("get_construction_tiles")
func get_construction_tiles(_ out_tiles: UnsafeMutablePointer<UnsafePointer<ConstructionTile>?>?,
                     _ out_len_x: UnsafeMutablePointer<size_t>?,
                     _ out_len_y: UnsafeMutablePointer<size_t>?)

@_silgen_name("free_construction_tiles")
func free_construction_tiles(_ tiles_ptr: UnsafeMutablePointer<ConstructionTile>?,
                      _ len_x: size_t,
                      _ len_y: size_t)

func fetchConstructionTiles(_ callback: @escaping ([[ConstructionTile]]) -> Void) {
    var tilesPtr: UnsafePointer<ConstructionTile>?
    var lenX: size_t = 0
    var lenY: size_t = 0

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

