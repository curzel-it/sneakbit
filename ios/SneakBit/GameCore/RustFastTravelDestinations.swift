import Foundation

func fetchAvailableFastTravelDestinations(_ callback: @escaping ([FastTravelDestination]) -> Void) {
    var length: UInt = 0

    guard let ptr = available_fast_travel_destinations_from_current_world_c(&length) else {
        print("Failed to fetch fast travel destinations")
        return
    }

    let buffer = UnsafeBufferPointer<FastTravelDestination>(start: ptr, count: Int(length))
    let items = Array(buffer)

    callback(items)
    free_fast_travel_destinations(ptr, length)
}
