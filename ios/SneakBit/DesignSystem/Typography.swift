import Foundation
import SwiftUI

extension View {
    func typography(_ font: AppFont) -> some View {
        self
            .font(font.font)
            .lineSpacing(font.lineSpacing)
    }
}

struct AppFont {
    let size: CGFloat
    let name: String
    let weight: Font.Weight
    let font: Font
    let lineSpacing: CGFloat

    init(name: String, size: CGFloat, weight: Font.Weight) {
        self.name = name
        self.size = size
        self.weight = weight
        self.font = .custom(name, size: size).weight(weight)
        self.lineSpacing = size / 3
    }
}

extension AppFont {
    static let largeTitle = AppFont(name: "PixelOperator8-Bold", size: 24, weight: .bold)
    static let title = AppFont(name: "PixelOperator8-Bold", size: 16, weight: .bold)
    static let text = AppFont(name: "PixelOperator8", size: 14, weight: .regular)
    static let menuOption = AppFont(name: "PixelOperator8", size: 16, weight: .regular)
    static let caption = AppFont(name: "PixelOperator8", size: 11, weight: .regular)
}
