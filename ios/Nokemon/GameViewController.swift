import SwiftUI
import UIKit

class GameViewController: UIViewController {
    private var gameView: GameView!
    private var gameEngine: GameEngine!

    override func viewDidLoad() {
        super.viewDidLoad()
        gameEngine = GameEngine()
        gameView = GameView(frame: view.bounds)
        gameView.engine = gameEngine
        gameView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(gameView)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        gameEngine.setupChanged(
            windowSize: view.bounds.size,
            scale: 1 // TODO: view.window?.screen.scale
        )
    }
    
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        // ...
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        // ...
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        // ...
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
