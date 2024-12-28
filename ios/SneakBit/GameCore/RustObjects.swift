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
        !match_result.in_progress
    }
    
    func shouldPauseGame() -> Bool {
        isGameOver() || messages.is_valid || has_requested_fast_travel || has_requested_pvp_arena
    }
}

func fetchRenderableItems(_ callback: @escaping ([RenderableItem]) -> Void) {
    var length: UInt = 0

    guard let ptr = get_renderables(&length) else {
        print("Failed to fetch renderables")
        return
    }

    let buffer = UnsafeBufferPointer<RenderableItem>(start: ptr, count: Int(length))
    let items = Array(buffer)

    callback(items)
    free_renderables(ptr, length)
}

func fetchWeapons(player: UInt, _ callback: @escaping ([AmmoRecap]) -> Void) {
    var length: UInt = 0

    guard let ptr = available_weapons_c(player, &length) else {
        print("Failed to fetch weapons")
        return
    }

    let buffer = UnsafeBufferPointer<AmmoRecap>(start: ptr, count: Int(length))
    let items = Array(buffer)

    callback(items)
    free_weapons(ptr, length)
}

extension AmmoRecap: Equatable {
    public static func == (lhs: AmmoRecap, rhs: AmmoRecap) -> Bool {
        lhs.weapon_species_id == rhs.weapon_species_id &&
        lhs.ammo_inventory_count == rhs.ammo_inventory_count &&
        lhs.is_equipped == rhs.is_equipped
    }
}

extension CMatchResult: Equatable {
    public static func == (lhs: CMatchResult, rhs: CMatchResult) -> Bool {
        lhs.game_over == rhs.game_over &&
        lhs.in_progress == rhs.in_progress &&
        lhs.unknown_winner == rhs.unknown_winner &&
        lhs.winner == rhs.winner
    }
}
