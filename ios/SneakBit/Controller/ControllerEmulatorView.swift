import Combine
import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    @StateObject private var viewModel = ControllerEmulatorViewModel()
    
    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width >= geo.size.height
            
            ZStack {
                JoystickView()
                
                HStack(spacing: .zero) {
                    if viewModel.isConfirmVisible {
                        KeyEmulatorView(key: .confirm)
                    }
                    if viewModel.isAttackVisible {
                        KeyEmulatorView(key: .attack)
                            .overlay(
                                Text(viewModel.attackLabel)
                                    .positioned(.bottom)
                                    .padding(.bottom, 12 + KeyEmulatorView.padding)
                                    .typography(.buttonCaption)
                                    .foregroundStyle(Color.black.opacity(0.9))
                            )
                    }
                }
                .positioned(.trailingBottom)
                .padding(.trailing, isLandscape ? 90 : 25)
                .padding(.trailing, viewModel.safeAreaInsets.right)
                .padding(.bottom, isLandscape ? 55 : 85)
                .padding(.bottom, viewModel.safeAreaInsets.bottom)
            }
            .padding(.top, viewModel.safeAreaInsets.top)
            .padding(.bottom, viewModel.safeAreaInsets.bottom)
        }
    }
}

private class ControllerEmulatorViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    @Published var isConfirmVisible: Bool = false
    @Published var isAttackVisible: Bool = false
    @Published var attackLabel: String = ""
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    var isLandscape: Bool {
        engine.isLandscape
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
}
