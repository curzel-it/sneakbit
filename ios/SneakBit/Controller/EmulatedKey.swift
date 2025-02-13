import Foundation

enum EmulatedKey {
    case up
    case right
    case down
    case left
    case closeRangeAttack
    case rangedAttack
    case backspace
    case confirm
    case escape
    case menu
}

extension EmulatedKey {
    var imageName: String {
        switch self {
        case .up: "up"
        case .down: "down"
        case .left: "left"
        case .right: "right"
        case .closeRangeAttack: "close_attack"
        case .rangedAttack: "attack"
        case .backspace: ""
        case .confirm: "confirm"
        case .escape: ""
        case .menu: "menu"
        }
    }
}

extension EmulatedKey {
    var isMovement: Bool {
        switch self {
        case .up, .right, .down, .left: true
        default: false
        }
    }
}
