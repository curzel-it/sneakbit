import Foundation

func fetchRenderableItems(_ callback: @escaping ([RenderableItem]) -> Void) {
    var length: UInt = 0

    guard let ptr = get_renderables(&length) else {
        print("Failed to fetch renderables")
        return
    }

    let buffer = UnsafeBufferPointer<RenderableItem>(start: ptr, count: Int(length))
    let items = Array(buffer)

    callback(items)
    free_renderables(ptr, length)
}
