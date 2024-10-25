import SwiftUI
import UIKit

class GameViewController: UIViewController {
    @Inject private var engine: GameEngine
    
    private var gameView: GameView!
    
    override func viewDidLoad() {
        super.viewDidLoad()
        gameView = GameView(frame: view.bounds)
        gameView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(gameView)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        engine.setupChanged(
            windowSize: view.bounds.size,
            screenScale: view.window?.screen.scale
        )
    }
}

struct GameViewRepresentable: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> GameViewController {
        GameViewController()
    }
    
    func updateUIViewController(_ uiViewController: GameViewController, context: Context) {
        print("Should probably update: \(context)")
    }
}
