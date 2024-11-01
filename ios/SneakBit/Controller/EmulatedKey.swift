import Foundation

enum EmulatedKey {
    case up
    case right
    case down
    case left
    case attack
    case backspace
    case confirm
    case escape
    case menu
}

extension EmulatedKey {
    var systemImageName: String {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .left: "arrow.left"
        case .right: "arrow.right"
        case .attack: "flame"
        case .backspace: "delete.left"
        case .confirm: "checkmark"
        case .escape: "xmark"
        case .menu: "list.bullet"
        }
    }
    
    var imageName: String {
        switch self {
        case .up: "up"
        case .down: "down"
        case .left: "left"
        case .right: "right"
        case .attack: "j"
        case .backspace: ""
        case .confirm: "k"
        case .escape: ""
        case .menu: ""
        }
    }
}
