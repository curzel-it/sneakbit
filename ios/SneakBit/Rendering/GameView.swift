import UIKit

class GameView: UIView {
    @Inject private var spritesProvider: SpritesProvider
    @Inject private var engine: GameEngine
            
    override init(frame: CGRect) {
        super.init(frame: frame)
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

        if engine.canRender {
            renderTileMap(in: context)
            renderNight(rect, in: context)
            renderEntities(in: context)
            renderLimitedVisibility(rect, in: context)
            
            #if DEBUG
                renderDebugInfo(context: context, rect: rect)
            #endif
        }
    }
    
    private func renderEntities(in context: CGContext) {
        engine.renderEntities { entity in
            self.render(entity: entity, in: context)
        }
    }
    
    private func render(entity: RenderableItem, in context: CGContext) {
        guard let image = spritesProvider.cgImage(for: entity) else { return }
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

    private func renderDebugInfo(context: CGContext, rect: CGRect) {
        let fpsText = String(format: "\nFPS: %.0f   ", engine.fps)
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
    
    private func renderTileMap(in context: CGContext) {
        guard let tileMapImage = engine.tileMapImage() else { return }
        guard let tileMapCgImage = tileMapImage.cgImage else { return }
        
        let cameraViewport = engine.cameraViewport
        let cameraOffset = engine.cameraViewportOffset
        let tileSize = CGFloat(TILE_SIZE) * engine.renderingScale
        let scaledMapSize = tileMapImage.size.scaled(engine.renderingScale)
        
        let offsetX = -CGFloat(cameraViewport.x) * tileSize - CGFloat(cameraOffset.x) * engine.renderingScale
        let offsetY = -CGFloat(cameraViewport.y) * tileSize - CGFloat(cameraOffset.y) * engine.renderingScale
        
        context.saveGState()
        context.translateBy(x: offsetX, y: offsetY)
        context.draw(tileMapCgImage, in: CGRect(origin: .zero, size: scaledMapSize))
        context.restoreGState()
    }
    
    private func renderNight(_ rect: CGRect, in context: CGContext) {
        guard engine.isNight else { return }
        context.setFillColor((UIColor(named: "overlay_night_color") ?? .clear).cgColor)
        context.fill(rect)
    }
    
    private func renderLimitedVisibility(_ rect: CGRect, in context: CGContext) {
        guard engine.isLimitedVisibility else { return }
        context.setFillColor(UIColor.black.cgColor)
        let centerX = rect.width / 2.0
        let centerY = rect.height / 2.0
        let tileSize = TILE_SIZE * engine.renderingScale
        let visibleAreaSize = tileSize * 9.0
        let visibleAreaHalf = visibleAreaSize / 2.0
        let halfTile = tileSize / 2.0
        let visibleAreaRect = CGRect(
            x: halfTile + centerX - visibleAreaHalf,
            y: centerY - visibleAreaHalf,
            width: visibleAreaSize,
            height: visibleAreaSize
        )
        
        context.fill(CGRect(x: 0, y: 0, width: rect.width, height: centerY - visibleAreaHalf))
        context.fill(CGRect(x: 0, y: centerY + visibleAreaHalf, width: rect.width, height: centerY - visibleAreaHalf))
        context.fill(CGRect(x: 0, y: 0, width: halfTile + centerX - visibleAreaHalf, height: rect.height))
        context.fill(CGRect(x: centerX + visibleAreaHalf + halfTile, y: 0, width: centerX - visibleAreaHalf, height: rect.height))
        
        if let image = spritesProvider.cgImage(for: UInt32(SPRITE_SHEET_CAVE_DARKNESS), textureRect: IntRect(x: 0, y: 0, w: 16, h: 16)) {
            render(texture: image, at: visibleAreaRect, in: context)
        }
    }
}
