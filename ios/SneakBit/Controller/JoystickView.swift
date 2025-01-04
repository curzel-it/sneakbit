import Foundation
import SwiftUI

struct JoystickView: View {
    @StateObject private var viewModel = JoystickViewModel()

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size

            ZStack {
                if viewModel.isDragging {
                    Image("joystick")
                        .interpolation(.none)
                        .resizable()
                        .frame(width: viewModel.baseRadius * 2, height: viewModel.baseRadius * 2)
                        .position(viewModel.center)
                    
                    Image("joystick_lever")
                        .interpolation(.none)
                        .resizable()
                        .frame(width: viewModel.leverRadius * 2, height: viewModel.leverRadius * 2)
                        .position(viewModel.dragLocation)
                }
            }
            .frame(width: size.width, height: size.height)
            .contentShape(Rectangle())
            .gesture(
                DragGesture()
                    .onChanged { value in
                        viewModel.handleDragChanged(value: value)
                    }
                    .onEnded { _ in
                        viewModel.handleDragEnded()
                    }
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private class JoystickViewModel: ObservableObject {
    static let size: CGFloat = 64
    
    @Inject private var engine: GameEngine
    
    @Published var dragLocation: CGPoint = .zero
    @Published var isDragging = false
    @Published var currentActiveKeys: Set<EmulatedKey> = []
    @Published var center: CGPoint = .zero
    
    let baseRadius: CGFloat = 32
    let leverRadius: CGFloat = 16
    let maxDistance: CGFloat = 16
    let maxFingerDistance: CGFloat = 48
    
    private let movesAlongWithGesture = true
    
    func handleDragChanged(value: DragGesture.Value) {
        if !isDragging {
            withAnimation {
                isDragging = true
            }
            center = value.startLocation
        }
        let location = value.location
        var vector = CGVector(dx: location.x - center.x, dy: location.y - center.y)
        var realDistance = hypot(vector.dx, vector.dy)
                
        if movesAlongWithGesture && realDistance > maxFingerDistance {
            let angle = atan2(vector.dy, vector.dx)
            let excessDistance = realDistance - maxFingerDistance
            center.x += cos(angle) * excessDistance
            center.y += sin(angle) * excessDistance
            vector = CGVector(dx: location.x - center.x, dy: location.y - center.y)
            realDistance = hypot(vector.dx, vector.dy)
        }
        
        let distance = min(realDistance, maxDistance)
        let angle = atan2(vector.dy, vector.dx)
        let limitedX = center.x + cos(angle) * distance
        let limitedY = center.y + sin(angle) * distance
        dragLocation = CGPoint(x: limitedX, y: limitedY)
        handleDirection(angle: angle)
    }

    func handleDragEnded() {
        withAnimation {
            isDragging = false
        }
        releaseCurrentKeys()
    }

    private func handleDirection(angle: CGFloat) {
        let adjustedAngle = (angle < 0 ? angle + 2 * .pi : angle) / CGFloat.pi
        let newActiveKeys = Set(directionForAngle(adjustedAngle))
        let keysToRelease = currentActiveKeys.subtracting(newActiveKeys)
        let keysToPress = newActiveKeys.subtracting(currentActiveKeys)
        
        for key in keysToRelease {
            engine.setKeyUp(key)
        }
        for key in keysToPress {
            engine.setKeyDown(key)
        }
        
        currentActiveKeys = newActiveKeys
    }

    private func releaseCurrentKeys() {
        for key in currentActiveKeys {
            engine.setKeyUp(key)
        }
        currentActiveKeys.removeAll()
    }
    
    private func directionForAngle(_ angle: CGFloat) -> [EmulatedKey] {
        switch angle {
        case 0..<1/8, 15/8..<2: [.right]
        case 1/8..<3/8: [.right, .down]
        case 3/8..<5/8: [.down]
        case 5/8..<7/8: [.down, .left]
        case 7/8..<9/8: [.left]
        case 9/8..<11/8: [.left, .up]
        case 11/8..<13/8: [.up]
        case 13/8..<15/8: [.up, .right]
        default: []
        }
    }
}
