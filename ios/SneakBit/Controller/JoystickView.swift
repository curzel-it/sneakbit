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
        engine.joystickAngle = 0
    }
    
    private func handleDirection(angle: CGFloat) {
        engine.joystickAngle = angle
    }
}
