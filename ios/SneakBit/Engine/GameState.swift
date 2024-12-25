import Foundation

struct GameState {
    let toasts: CToast
    let messages: CDisplayableMessage
    let kunai: Int32
    let isInteractionAvailable: Bool
    let matchResult: CMatchResult
    let heroHp: Float32
    let isSwordEquipped: Bool
    let hasRequestedFastTravel: Bool
    let hasRequestedPvpArena: Bool
    let currentPlayerIndex: UInt
    
    func isGameOver() -> Bool {
        matchResult.game_over
    }
    
    func shouldPauseGame() -> Bool {
        isGameOver() || messages.is_valid || hasRequestedFastTravel || hasRequestedPvpArena
    }
}
