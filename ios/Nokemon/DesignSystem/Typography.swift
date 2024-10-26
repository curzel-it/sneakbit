import Foundation
import SwiftUI

extension View {
    func typography(_ font: AppFont) -> some View {
        self.font(font.font)
    }
}

struct AppFont {
    let size: CGFloat
    let name: String
    let weight: Font.Weight
    let font: Font

    init(name: String, size: CGFloat, weight: Font.Weight) {
        self.name = name
        self.size = size
        self.weight = weight
        self.font = .custom(name, size: size).weight(weight)
    }
}

extension AppFont {
    static let largeTitle = AppFont(name: "PixelOperator8-Bold", size: 24, weight: .bold)
    static let title = AppFont(name: "PixelOperator8-Bold", size: 18, weight: .bold)
    static let text = AppFont(name: "PixelOperator8", size: 16, weight: .regular)
}
