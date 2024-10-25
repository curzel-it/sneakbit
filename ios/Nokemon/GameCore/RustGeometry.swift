import Foundation

@frozen
public struct IntRect: Hashable {
    public var x: Int32
    public var y: Int32
    public var width: Int32
    public var height: Int32
}

@frozen
public struct Vector2d {
    public var x: Float
    public var y: Float
}

extension IntRect {
    static let zero = IntRect(x: 0, y: 0, width: 0, height: 0)
    
    init(with other: IntRect) {
        x = other.x
        y = other.y
        width = other.width
        height = other.height
    }
    
    func cgRect() -> CGRect {
        CGRect(
           x: CGFloat(x),
           y: CGFloat(y),
           width: CGFloat(width),
           height: CGFloat(height)
        )
    }
}

extension Vector2d {
    static let zero = Vector2d(x: 0, y: 0)
}
