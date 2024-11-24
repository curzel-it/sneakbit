import Combine
import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    @StateObject private var viewModel = ControllerEmulatorViewModel()
    
    var body: some View {
        GeometryReader { geo in
            let screenSize = geo.size
            let isLandscape = screenSize.width >= screenSize.height
            
            ZStack {
                JoystickView()
                
                if viewModel.isConfirmVisible {
                    let defaultPosition = CGPoint(
                        x: screenSize.width - (isLandscape ? 60 : 25) - viewModel.safeAreaInsets.right,
                        y: screenSize.height - (isLandscape ? 55 : 85) - viewModel.safeAreaInsets.bottom
                    )
                    
                    DraggableButtonView(
                        key: .confirm,
                        label: nil,
                        position: $viewModel.confirmButtonPosition,
                        defaultPosition: defaultPosition,
                        savePosition: {
                            viewModel.saveButtonPositions()
                        }
                    )
                }
                
                if viewModel.isAttackVisible {
                    let defaultPosition = CGPoint(
                        x: screenSize.width - (isLandscape ? 60 : 25) - viewModel.safeAreaInsets.right,
                        y: screenSize.height - (isLandscape ? 55 : 85) - viewModel.safeAreaInsets.bottom
                    )
                    
                    DraggableButtonView(
                        key: .attack,
                        label: viewModel.attackLabel,
                        position: $viewModel.attackButtonPosition,
                        defaultPosition: defaultPosition,
                        savePosition: {
                            viewModel.saveButtonPositions()
                        }
                    )
                }
            }
            .coordinateSpace(name: "controllerArea")
            .onChange(of: isLandscape) { _, newValue in
                viewModel.isLandscape = newValue
                viewModel.loadButtonPositions()
            }
            .onAppear {
                viewModel.isLandscape = isLandscape
                viewModel.loadButtonPositions()
            }
        }
    }
}

private class ControllerEmulatorViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isConfirmVisible: Bool = false
    @Published var isAttackVisible: Bool = false
    @Published var attackLabel: String = ""
    @Published var attackButtonPosition: CGPoint = .zero
    @Published var confirmButtonPosition: CGPoint = .zero
    @Published var isLandscape: Bool = false
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bindNumberOfKunais()
        bindInteractionAvailable()
    }
    
    private func bindNumberOfKunais() {
        engine.kunai
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] count in
                withAnimation {
                    self?.isAttackVisible = count > 0
                    self?.attackLabel = "x\(count)"
                }
            }
            .store(in: &disposables)
    }
    
    private func bindInteractionAvailable() {
        engine.isInteractionAvailable
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] available in
                withAnimation {
                    self?.isConfirmVisible = available
                }
            }
            .store(in: &disposables)
    }
    
    func saveButtonPositions() {
        savePosition(attackButtonPosition, forKey: "attackButtonPosition")
        savePosition(confirmButtonPosition, forKey: "confirmButtonPosition")
    }
    
    func loadButtonPositions() {
        if let attackPosition = loadPosition(forKey: "attackButtonPosition") {
            self.attackButtonPosition = attackPosition
        }
        if let confirmPosition = loadPosition(forKey: "confirmButtonPosition") {
            self.confirmButtonPosition = confirmPosition
        }
    }
    
    private func savePosition(_ position: CGPoint, forKey key: String) {
        let orientationKey = isLandscape ? "Landscape" : "Portrait"
        let keyWithOrientation = "\(key)_\(orientationKey)"
        let positionDict = ["x": position.x, "y": position.y]
        UserDefaults.standard.set(positionDict, forKey: keyWithOrientation)
    }

    private func loadPosition(forKey key: String) -> CGPoint? {
        let orientationKey = isLandscape ? "Landscape" : "Portrait"
        let keyWithOrientation = "\(key)_\(orientationKey)"
        if let positionDict = UserDefaults.standard.dictionary(forKey: keyWithOrientation) as? [String: CGFloat],
           let x = positionDict["x"],
           let y = positionDict["y"] {
            return CGPoint(x: x, y: y)
        }
        return nil
    }
}

struct DraggableButtonView: View {
    let key: EmulatedKey
    let label: String?
    @Binding var position: CGPoint
    var defaultPosition: CGPoint
    var savePosition: () -> Void

    @GestureState private var dragOffset = CGSize.zero
    @State private var isDragging = false

    var body: some View {
        let actualPosition = (position == .zero) ? defaultPosition : position

        let longPressDragGesture = LongPressGesture(minimumDuration: 0.5)
            .sequenced(before: DragGesture())
            .updating($dragOffset) { value, state, _ in
                switch value {
                case .second(true, let drag?):
                    state = drag.translation
                default:
                    break
                }
            }
            .onEnded { value in
                isDragging = false
                switch value {
                case .second(true, let drag?):
                    position = CGPoint(
                        x: actualPosition.x + drag.translation.width,
                        y: actualPosition.y + drag.translation.height
                    )
                    savePosition()
                default:
                    break
                }
            }

        KeyEmulatorView(key: key)
            .overlay(
                label.map {
                    Text($0)
                        .positioned(.bottom)
                        .padding(.bottom, 12 + KeyEmulatorView.padding)
                        .typography(.buttonCaption)
                        .foregroundStyle(Color.black.opacity(0.9))
                }
            )
            .position(x: actualPosition.x + dragOffset.width, y: actualPosition.y + dragOffset.height)
            .gesture(longPressDragGesture)
    }
}
