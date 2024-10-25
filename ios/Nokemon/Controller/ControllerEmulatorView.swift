import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    var body: some View {
        HStack {
            Spacer()
            KeyEmulatorView(key: .attack)
            KeyEmulatorView(key: .confirm)
            JoystickView()
            /*
            ZStack {
                KeyEmulatorView(key: .up).positioned(.top)
                KeyEmulatorView(key: .right).positioned(.trailing)
                KeyEmulatorView(key: .down).positioned(.bottom)
                KeyEmulatorView(key: .left).positioned(.leading)
            }
            .frame(width: KeyEmulatorView.size.width * 3)
            .frame(height: KeyEmulatorView.size.height * 3)*/
        }
        .padding()
    }
}

struct KeyEmulatorView: View {
    static let size = CGSize(width: 40, height: 40)
    static let iconSize: CGFloat = 24
    
    let key: EmulatedKey
    
    @State private var isPressed = false

    var body: some View {
        Image(systemName: key.imageName)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: KeyEmulatorView.iconSize)
            .frame(height: KeyEmulatorView.iconSize)
            .foregroundStyle(Color.black)
            .frame(size: KeyEmulatorView.size)
            .background(Color.gray.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .onLongPressGesture(minimumDuration: 0, maximumDistance: .infinity, pressing: { pressing in
                if pressing {
                    if !isPressed {
                        isPressed = true
                        GameEngine.shared.setKeyDown(key)
                    }
                } else {
                    if isPressed {
                        isPressed = false
                        GameEngine.shared.setKeyUp(key)
                    }
                }
            }, perform: {})
    }
}

struct JoystickView: View {
    @State private var dragLocation: CGPoint = .zero
    @State private var isDragging = false
    @State private var activeKeys: Set<EmulatedKey> = []

    let outerRadius: CGFloat = 56
    let innerRadius: CGFloat = 32

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            
            ZStack {
                // Outer Circle
                Circle()
                    .fill(Color.gray.opacity(0.6))
                    .frame(width: outerRadius * 2, height: outerRadius * 2)
                    .position(center)
                
                // Inner Circle
                Circle()
                    .fill(Color.gray.opacity(0.7))
                    .frame(width: innerRadius * 2, height: innerRadius * 2)
                    .position(isDragging ? dragLocation : center)
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                isDragging = true
                                let location = value.location
                                let vector = CGVector(dx: location.x - center.x, dy: location.y - center.y)
                                let distance = min(sqrt(vector.dx * vector.dx + vector.dy * vector.dy), outerRadius)
                                
                                // Adjust for SwiftUI coordinate system (invert dy)
                                let adjustedVector = CGVector(dx: vector.dx, dy: -(vector.dy))
                                
                                let angle = atan2(adjustedVector.dy, adjustedVector.dx)
                                
                                let limitedX = center.x + cos(angle) * distance
                                let limitedY = center.y - sin(angle) * distance // Subtract to adjust for inverted y-axis
                                
                                dragLocation = CGPoint(x: limitedX, y: limitedY)
                                
                                // Handle direction
                                handleDirection(angle: angle)
                            }
                            .onEnded { _ in
                                isDragging = false
                                dragLocation = center
                                releaseAllKeys()
                            }
                    )
            }
            .frame(width: size.width, height: size.height)
        }
        .frame(width: outerRadius * 2 + 40, height: outerRadius * 2 + 40)
    }
    
    private func handleDirection(angle: CGFloat) {
        // Determine the direction based on the angle
        var newActiveKeys: Set<EmulatedKey> = []
        
        // Map angles to the four cardinal directions
        let adjustedAngle = angle < 0 ? angle + 2 * .pi : angle
        
        // Define the ranges for each direction (in radians)
        let pi = CGFloat.pi
        let rightRange = (-pi / 4)...(pi / 4)
        let upRange = (pi / 4)...(3 * pi / 4)
        let leftRange = (3 * pi / 4)...(5 * pi / 4)
        let downRange = (5 * pi / 4)...(7 * pi / 4)
        
        // Since angle ranges wrap around, adjust accordingly
        if rightRange.contains(adjustedAngle) || (adjustedAngle >= 7 * .pi / 4 && adjustedAngle <= 2 * .pi) {
            newActiveKeys.insert(.right)
        } else if upRange.contains(adjustedAngle) {
            newActiveKeys.insert(.up)
        } else if leftRange.contains(adjustedAngle) {
            newActiveKeys.insert(.left)
        } else if downRange.contains(adjustedAngle) {
            newActiveKeys.insert(.down)
        }
        
        updateActiveKeys(newActiveKeys)
    }
    
    private func updateActiveKeys(_ newActiveKeys: Set<EmulatedKey>) {
        // Release keys that are no longer active
        let keysToRelease = activeKeys.subtracting(newActiveKeys)
        for key in keysToRelease {
            GameEngine.shared.setKeyUp(key)
        }
        
        // Press keys that are newly active
        let keysToPress = newActiveKeys.subtracting(activeKeys)
        for key in keysToPress {
            GameEngine.shared.setKeyDown(key)
        }
        
        // Update active keys
        activeKeys = newActiveKeys
    }
    
    private func releaseAllKeys() {
        for key in activeKeys {
            GameEngine.shared.setKeyUp(key)
        }
        activeKeys.removeAll()
    }
}


extension EmulatedKey {
    var imageName: String {
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
}
