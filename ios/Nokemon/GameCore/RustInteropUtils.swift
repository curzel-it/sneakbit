import Foundation

func string(from pointer: UnsafePointer<CChar>?) -> String? {
    guard let pointer else {
        return nil
    }
    return String(cString: pointer)
}


func strings(from pointer: UnsafePointer<UnsafePointer<CChar>?>?, count: Int) -> [String] {
    guard let pointer else { return [] }
    
    return (0..<count).compactMap { index in
        let cStringPointer = pointer[index]
        return string(from: cStringPointer)
    }
}
