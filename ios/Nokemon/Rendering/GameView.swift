import UIKit

class GameView: UIView {
    var engine: GameEngine? {
        didSet {
            engine?.onNewFrame = { [weak self] in
                self?.setNeedsDisplay()
            }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        commonInit()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        commonInit()
    }

    private func commonInit() {
        backgroundColor = .black
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext(), let engine = engine else { return }
        context.setFillColor(UIColor.black.cgColor)
        context.fill(rect)
        context.interpolationQuality = .none

        engine.renderEntities { entity in
            if let image = engine.spritesProvider.cgImage(for: entity) {
                let frame = engine.renderingFrame(for: entity)
                context.saveGState()
                context.translateBy(x: frame.origin.x, y: frame.origin.y)
                context.scaleBy(x: 1.0, y: -1.0)
                context.translateBy(x: 0, y: -frame.size.height)
                
                context.draw(image, in: CGRect(origin: .zero, size: frame.size))
                context.restoreGState()
            }
        }

        drawDebugInfo(context: context, rect: rect)
    }

    private func drawDebugInfo(context: CGContext, rect: CGRect) {
        guard let engine = engine else { return }

        let fpsText = String(format: "FPS: %.0f", engine.fps)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.monospacedDigitSystemFont(ofSize: 14, weight: .medium),
            .foregroundColor: UIColor.white
        ]
        let textSize = fpsText.size(withAttributes: attributes)
        let textRect = CGRect(
            x: rect.maxX - textSize.width - 10,
            y: rect.minY + 10,
            width: textSize.width,
            height: textSize.height
        )
        fpsText.draw(in: textRect, withAttributes: attributes)
    }
}
