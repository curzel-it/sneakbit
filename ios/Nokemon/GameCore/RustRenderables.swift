import Foundation

@frozen
public struct RenderableItem {
    public var sprite_sheet_id: UInt32
    public var texture_rect: IntRect
    public var offset: Vector2d
    public var frame: IntRect
}

@_silgen_name("get_renderables")
func get_renderables(_ length: UnsafeMutablePointer<size_t>?) -> UnsafeMutablePointer<RenderableItem>?

@_silgen_name("free_renderables")
func free_renderables(_ ptr: UnsafeMutablePointer<RenderableItem>?, _ length: size_t)

func fetchRenderableItems(_ callback: @escaping ([RenderableItem]) -> Void) {
    var length: size_t = 0

    guard let ptr = get_renderables(&length) else {
        print("Failed to fetch renderables")
        return
    }

    let buffer = UnsafeBufferPointer<RenderableItem>(start: ptr, count: length)
    let items = Array(buffer)

    callback(items)
    free_renderables(ptr, length)
}
