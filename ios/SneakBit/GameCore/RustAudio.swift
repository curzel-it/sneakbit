import Foundation

func fetchSoundEffects(_ callback: @escaping ([SoundEffect]) -> Void) {
    var length: UInt = 0

    guard let ptr = get_current_sound_effects(&length) else {
        print("Failed to fetch renderables")
        return
    }

    let buffer = UnsafeBufferPointer<SoundEffect>(start: ptr, count: Int(length))
    let items = Array(buffer)

    callback(items)
    free_sound_effects(ptr, length)
}
