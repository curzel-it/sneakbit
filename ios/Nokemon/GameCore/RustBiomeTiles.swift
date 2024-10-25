import Foundation

public typealias Biome = UInt32

@frozen
public struct BiomeTile {
    public var tile_type: Biome
    public var tile_up_type: Biome
    public var tile_right_type: Biome
    public var tile_down_type: Biome
    public var tile_left_type: Biome
    public var texture_offset_x: Int32
    public var texture_offset_y: Int32
}

extension BiomeTile {
    init(with other: BiomeTile) {
        tile_type = other.tile_type
        tile_up_type = other.tile_up_type
        tile_right_type = other.tile_right_type
        tile_down_type = other.tile_down_type
        tile_left_type = other.tile_left_type
        texture_offset_x = other.texture_offset_x
        texture_offset_y = other.texture_offset_y
    }
}

@_silgen_name("get_biome_tiles")
func get_biome_tiles(_ out_tiles: UnsafeMutablePointer<UnsafePointer<BiomeTile>?>?,
                     _ out_len_x: UnsafeMutablePointer<size_t>?,
                     _ out_len_y: UnsafeMutablePointer<size_t>?)

@_silgen_name("free_biome_tiles")
func free_biome_tiles(_ tiles_ptr: UnsafeMutablePointer<BiomeTile>?,
                      _ len_x: size_t,
                      _ len_y: size_t)

func fetchBiomeTiles(_ callback: @escaping ([[BiomeTile]]) -> Void) {
    var tilesPtr: UnsafePointer<BiomeTile>?
    var lenX: size_t = 0
    var lenY: size_t = 0

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
