import Foundation
import SwiftUI

@frozen
public struct NonColorC {
    public let red: UInt8
    public let green: UInt8
    public let blue: UInt8
    public let alpha: UInt8
}

extension NonColorC {
    func asColor() -> Color {
        Color(
            red: Double(red) / 255.0,
            green: Double(green) / 255.0,
            blue: Double(blue) / 255.0,
            opacity: Double(alpha) / 255.0
        )
    }
    
    func asSolidColor() -> Color {
        Color(
            red: Double(red) / 255.0,
            green: Double(green) / 255.0,
            blue: Double(blue) / 255.0,
            opacity: 1.0
        )
    }
    
    func opacity() -> CGFloat {
        CGFloat(alpha) / 255.0
    }
}
