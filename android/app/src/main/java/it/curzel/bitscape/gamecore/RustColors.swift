import Foundation
import SwiftUI

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
