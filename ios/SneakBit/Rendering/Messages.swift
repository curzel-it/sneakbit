import Combine
import Foundation
import SwiftUI
import Schwifty
import StoreKit

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
            
            if viewModel.showLinkToStore {
                Button("ok_action".localized()) {
                    viewModel.openStoreLink()
                }
                .buttonStyle(.menuOption)
            }
            if viewModel.showMaybeLater {
                Button("maybe_later_action".localized()) {
                    viewModel.onConfirm()
                }
                .buttonStyle(.menuOption)
            }
            if viewModel.showOk {
                Button("ok_action".localized()) {
                    viewModel.onConfirm()
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
    @Published var isVisible: Bool = false
    @Published var showLinkToStore: Bool = false
    @Published var showMaybeLater: Bool = false
    @Published var showOk: Bool = false
    
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
        
        let newText = string(from: message.text)
        
        if newText == "leaveareview" {
            text = "leave_a_review_in_game".localized()
            showLinkToStore = true
            showMaybeLater = true
            showOk = false
        } else {
            text = newText
            showLinkToStore = false
            showMaybeLater = false
            showOk = true
        }
        
        withAnimation {
            isVisible = true
        }
    }
    
    private func hide() {
        withAnimation {
            isVisible = false
            showLinkToStore = false
            showMaybeLater = false
            showOk = true
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
    
    func openStoreLink() {
        onConfirm()
        
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            SKStoreReviewController.requestReview(in: scene)
        } else if let scene = UIApplication.shared.windows.first?.windowScene {
            SKStoreReviewController.requestReview(in: scene)
        } else {
            URL(string: "https://apps.apple.com/app/sneakbit/id6737452377")?.visit()
        }
    }
}
