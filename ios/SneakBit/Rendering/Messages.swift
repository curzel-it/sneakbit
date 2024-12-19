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
            ForEach(viewModel.options.indices, id: \.self) { index in
                Button(viewModel.options[index]) {
                    viewModel.selectOption(at: index)
                }
                .buttonStyle(.menuOption)
            }
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
    @Published var options: [String] = []
    @Published var isVisible: Bool = false
    @Published var opacity: CGFloat = 0
    
    let borderColor: Color = .gray
    let backgroundColor: Color = .menuBackground
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.messages
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                if let message, message.is_valid {
                    self?.load(message)
                } else {
                    self?.hide()
                }
            }
            .store(in: &disposables)
    }
    
    private func load(_ message: CDisplayableMessage) {
        engine.pause()
        withAnimation {
            options = ["ok_action".localized()]
            title = string(from: message.title)
            text = string(from: message.text)
            isVisible = true
        }
    }
    
    private func hide() {
        withAnimation {
            options = []
            isVisible = false
        }
    }
    
    func cancel() {
        engine.setKeyDown(.escape)
        hide()
    }
    
    func selectOption(at index: Int) {
        engine.resume()
        hide()
    }
}
