import Combine
import Foundation
import SwiftUI
import Schwifty

struct MessagesView: View {
    @StateObject private var viewModel = MessagesViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Rectangle()
                    .frame(maxWidth: .infinity)
                    .frame(maxHeight: .infinity)
                    .foregroundStyle(Color.black.opacity(0.4))
                    .onTapGesture { viewModel.cancel() }
                
                MessagesContents()
                    .padding()
                    .frame(maxWidth: 600)
                    .background {
                        ZStack {
                            RoundedRectangle(cornerRadius: 4)
                                .foregroundStyle(viewModel.borderColor)
                            
                            RoundedRectangle(cornerRadius: 3)
                                .foregroundStyle(viewModel.backgroundColor)
                                .padding(2)
                        }
                    }
                    .padding()
                    .padding(.top, viewModel.safeAreaInsets.top)
                    .padding(.trailing, viewModel.safeAreaInsets.right)
                    .padding(.bottom, viewModel.safeAreaInsets.bottom)
                    .padding(.leading, viewModel.safeAreaInsets.left)
                    .positioned(.bottom)
            }
            .environmentObject(viewModel)
        }
    }
}

private struct MessagesContents: View {
    @EnvironmentObject private var viewModel: MessagesViewModel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let title = viewModel.title {
                Text(title)
                    .multilineTextAlignment(.leading)
                    .typography(.title)
            }
            if let text = viewModel.text {
                Text(text)
                    .multilineTextAlignment(.leading)
                    .typography(.text)
            }
            Button("ok_action".localized()) {
                viewModel.onConfirm()
            }
            .buttonStyle(.menuOption)
        }
    }
}

private class MessagesViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    @Published var title: String? = nil
    @Published var text: String? = nil
    @Published var isVisible: Bool = false
    
    let borderColor: Color = .gray
    let backgroundColor: Color = .menuBackground
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.gameState()
            .map { $0.messages }
            .removeDuplicates()
            .sink { [weak self] message in
                if message.is_valid {
                    self?.load(message)
                } else {
                    self?.hide()
                }
            }
            .store(in: &disposables)
    }
    
    private func load(_ message: CDisplayableMessage) {
        engine.pauseGame()
        title = string(from: message.title)
        text = string(from: message.text)
        
        withAnimation {
            isVisible = true
        }
    }
    
    private func hide() {
        withAnimation {
            isVisible = false
        }
    }
    
    func cancel() {
        engine.setKeyDown(.escape)
        hide()
    }
    
    func onConfirm() {
        engine.resumeGame()
        hide()
    }
}
