import Foundation

func fetchInventory(_ callback: @escaping ([InventoryItem]) -> Void) {
    var length: UInt = 0

    guard let ptr = inventory_state(&length) else {
        print("Failed to fetch inventory state")
        return
    }

    let buffer = UnsafeBufferPointer<InventoryItem>(start: ptr, count: Int(length))
    let items = Array(buffer)

    callback(items)
    free_inventory_state(ptr, length)
}
