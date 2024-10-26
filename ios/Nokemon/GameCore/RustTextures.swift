import Foundation

@frozen
public struct TextureInfo {
    public var key: UInt32
    public var source_rect: IntRect
}

@frozen
public struct BordersTextures {
    public var corner_top_left: TextureInfo
    public var corner_top_right: TextureInfo
    public var corner_bottom_right: TextureInfo
    public var corner_bottom_left: TextureInfo
    public var side_top: TextureInfo
    public var side_right: TextureInfo
    public var side_bottom: TextureInfo
    public var side_left: TextureInfo
}
