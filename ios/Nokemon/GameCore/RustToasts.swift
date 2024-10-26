import Foundation

@frozen
public struct ToastState {
    public var background_color: NonColorC
    public var text: String
    public var mode: ToastMode
    public var image: ToastImageState
}

@frozen
public struct ToastImageState {
    public var sprite_sheet_id: UInt32
    public var texture_frame: IntRect
}

public typealias ToastMode = UInt32
