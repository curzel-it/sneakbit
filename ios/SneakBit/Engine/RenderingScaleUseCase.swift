import Foundation
import SwiftUI

protocol RenderingScaleUseCase {
    func calculate(windowSize: CGSize, screenScale: CGFloat?) -> CGFloat
}

class RenderingScaleUseCaseImpl: RenderingScaleUseCase {
    func calculate(windowSize: CGSize, screenScale: CGFloat?) -> CGFloat {
        if UIDevice.current.userInterfaceIdiom == .tv {
            return 4.0
        }
        if UIDevice.current.userInterfaceIdiom == .pad {
            return 3.0
        }
        if (screenScale ?? 0) > 1 {
            return 2.0
        }
        return 1
    }
}
