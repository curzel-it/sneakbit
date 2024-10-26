import Foundation

@frozen
public struct ToastState {
    public var background_color: NonColorC
    public var text: String
    public var mode: ToastMode
    public var image: ToastImage
}

@frozen
public struct ToastImage {
    public var sprite_frame: IntRect
    public var sprite_sheet_id: UInt32
    public var number_of_frames: Int32
}

public typealias ToastMode = UInt32

extension ToastState {
    init(with other: ToastState) {
        self.background_color = other.background_color
        self.text = other.text
        self.mode = other.mode
        self.image = ToastImage(with: other.image)
    }
}

extension ToastImage {
    init(with other: ToastImage) {
        self.sprite_frame = other.sprite_frame
        self.sprite_sheet_id = other.sprite_sheet_id
        self.number_of_frames = other.number_of_frames
    }
}
