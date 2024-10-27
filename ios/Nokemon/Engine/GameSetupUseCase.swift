import Foundation

protocol GameSetupUseCase {
    func setup() async
}

class GameSetupUseCaseImpl: GameSetupUseCase {
    func setup() async {
        // ...
    }
}
