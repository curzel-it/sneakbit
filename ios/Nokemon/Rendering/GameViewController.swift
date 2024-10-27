import SwiftUI
import UIKit

class GameViewController: UIViewController {
    @Inject private var engine: GameEngine
    @Inject private var gameSetup: GameSetupUseCase
    
    private var gameView: GameView!
    private var displayLink: CADisplayLink?
    private var lastUpdateTime: CFTimeInterval = CACurrentMediaTime()
    
    override func viewDidLoad() {
        super.viewDidLoad()
        gameView = GameView(frame: view.bounds)
        gameView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(gameView)
        view.backgroundColor = .black
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        Task {
            await gameSetup.setup()
            disconnectDisplayLink()
            connectDisplayLink()
        }
    }
    
    override func viewWillDisappear(_ animated: Bool) {
        disconnectDisplayLink()
    }
    
    @objc private func gameLoop() {
        let currentTime = displayLink?.timestamp ?? CACurrentMediaTime()
        let deltaTime = min(currentTime - lastUpdateTime, 0.05)
        lastUpdateTime = currentTime
        engine.update(deltaTime: Float(deltaTime))
        gameView.setNeedsDisplay()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        engine.setupChanged(
            safeArea: view.window?.safeAreaInsets,
            windowSize: view.bounds.size,
            screenScale: view.window?.screen.scale
        )
    }
    
    private func connectDisplayLink() {
        displayLink = CADisplayLink(target: self, selector: #selector(gameLoop))
        displayLink?.preferredFrameRateRange = .init(minimum: 30, maximum: 90, __preferred: 60)
        displayLink?.add(to: .main, forMode: .default)
    }
    
    private func disconnectDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }
}

struct GameViewRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> GameViewController {
        GameViewController()
    }
    
    func updateUIViewController(_ uiViewController: GameViewController, context: Context) {
        // ...
    }
}
