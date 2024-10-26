import Foundation

func string(from pointer: UnsafePointer<CChar>?) -> String? {
    guard let validPointer = pointer else {
        return nil
    }
    return String(cString: validPointer)
}
