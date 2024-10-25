import SwiftUI
import UIKit

class GameViewController: UIViewController {
    private var gameView: GameView!
    
    override func viewDidLoad() {
        super.viewDidLoad()
        gameView = GameView(frame: view.bounds)
        gameView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(gameView)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        GameEngine.shared.setupChanged(
            windowSize: view.bounds.size,
            screenScale: view.window?.screen.scale
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
