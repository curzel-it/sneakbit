import UIKit

class GameView: UIView {
    private let engine: GameEngine
        
    required init(engine: GameEngine, frame: CGRect) {
        self.engine = engine
        super.init(frame: frame)
        
        self.engine.onNewFrame = { [weak self] in
            self?.setNeedsDisplay()
        }
        backgroundColor = .black
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        context.setFillColor(UIColor.black.cgColor)
        context.fill(rect)
        context.interpolationQuality = .none

        renderBiomes(in: context)
        renderConstructions(in: context)
        renderEntities(in: context)

        drawDebugInfo(context: context, rect: rect)
    }
    
    private func renderBiomes(in context: CGContext) {
        engine.renderBiomeTiles { textureX, textureY, row, col in
            self.renderBiome(textureX, textureY, row, col, in: context)
        }
    }
    
    private func renderBiome(_ textureX: Int32, _ textureY: Int32, _ row: Int32, _ col: Int32, in context: CGContext) {
        let textureRect = IntRect(x: textureX, y: textureY, width: 1, height: 1)
        let renderingRect = IntRect(x: col, y: row, width: 1, height: 1)
        
        guard let image = engine.spritesProvider.cgImage(
            for: UInt32(SPRITE_SHEET_BIOME_TILES),
            textureRect: textureRect
        ) else { return }
        
        let frame = engine.renderingFrame(for: renderingRect)
        render(texture: image, at: frame, in: context)
    }
    
    private func renderConstructions(in context: CGContext) {
        engine.renderConstructionTiles { textureX, textureY, row, col in
            self.renderConstruction(textureX, textureY, row, col, in: context)
        }
    }
    
    private func renderConstruction(_ textureX: Int32, _ textureY: Int32, _ row: Int32, _ col: Int32, in context: CGContext) {
        let textureRect = IntRect(x: textureX, y: textureY, width: 1, height: 1)
        let renderingRect = IntRect(x: col, y: row, width: 1, height: 1)
        
        guard let image = engine.spritesProvider.cgImage(
            for: UInt32(SPRITE_SHEET_CONSTRUCTION_TILES),
            textureRect: textureRect
        ) else { return }
        
        let frame = engine.renderingFrame(for: renderingRect)
        render(texture: image, at: frame, in: context)
    }
    
    private func renderEntities(in context: CGContext) {
        engine.renderEntities { entity in
            self.render(entity: entity, in: context)
        }
    }
    
    private func render(entity: RenderableItem, in context: CGContext) {
        guard let image = engine.spritesProvider.cgImage(for: entity) else { return }
        let frame = engine.renderingFrame(for: entity)
        render(texture: image, at: frame, in: context)
    }
    
    private func render(texture: CGImage, at frame: CGRect, in context: CGContext) {
        context.saveGState()
        context.translateBy(x: frame.origin.x, y: frame.origin.y)
        context.scaleBy(x: 1.0, y: -1.0)
        context.translateBy(x: 0, y: -frame.size.height)
        context.draw(texture, in: CGRect(origin: .zero, size: frame.size))
        context.restoreGState()
    }

    private func drawDebugInfo(context: CGContext, rect: CGRect) {
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
