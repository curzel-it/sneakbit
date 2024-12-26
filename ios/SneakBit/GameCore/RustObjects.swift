import Foundation

extension IntRect {
    static let zero = IntRect(x: 0, y: 0, w: 0, h: 0)
    
    func cgRect() -> CGRect {
        CGRect(
           x: CGFloat(x),
           y: CGFloat(y),
           width: CGFloat(w),
           height: CGFloat(h)
        )
    }
}

extension IntRect: Hashable, Equatable {
    public func hash(into hasher: inout Hasher) {
        hasher.combine(x)
        hasher.combine(y)
        hasher.combine(w)
        hasher.combine(h)
    }
    
    public static func == (lhs: IntRect, rhs: IntRect) -> Bool {
        lhs.x == rhs.x && lhs.y == rhs.y && lhs.w == rhs.w && lhs.h == rhs.h
    }
}

extension Vector2d {
    static let zero = Vector2d(x: 0, y: 0)
}

extension CDisplayableMessage: Equatable {
    public static func == (lhs: CDisplayableMessage, rhs: CDisplayableMessage) -> Bool {
        if lhs.is_valid && rhs.is_valid {
            string(from: lhs.text) == string(from: rhs.text)
        } else {
            lhs.is_valid == rhs.is_valid
        }
    }
}

extension CToast: Equatable {
    public static func == (lhs: CToast, rhs: CToast) -> Bool {
        if lhs.is_valid && rhs.is_valid {
            string(from: lhs.text) == string(from: rhs.text)
        } else {
            lhs.is_valid == rhs.is_valid
        }
    }
}

extension GameState {
    func isGameOver() -> Bool {
        match_result.game_over
    }
    
    func shouldPauseGame() -> Bool {
        isGameOver() || messages.is_valid || has_requested_fast_travel || has_requested_pvp_arena
    }
}
