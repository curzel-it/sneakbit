import Combine
import Foundation
import SwiftUI
import Schwifty

struct MenuView: View {
    @StateObject private var viewModel = MenuViewModel()
    
    var body: some View {
        if viewModel.isVisible {
            ZStack {
                Rectangle()
                    .frame(maxWidth: .infinity)
                    .frame(maxHeight: .infinity)
                    .foregroundStyle(Color.black.opacity(0.4))
                    .onTapGesture { viewModel.cancel() }
                
                VStack(spacing: 20) {
                    if let title = viewModel.title {
                        Text(title)
                            .textAlign(.leading)
                            .typography(.title)
                    }
                    if let text = viewModel.text {
                        Text(text)
                            .textAlign(.leading)
                            .typography(.text)
                    }
                    ForEach(viewModel.options.indices, id: \.self) { index in
                        Button(viewModel.options[index]) {
                            viewModel.selectOption(at: index)
                        }
                        .buttonStyle(.menuOption)
                    }
                }
                .padding()
                .frame(maxWidth: 400)
                .background {
                    ZStack {
                        RoundedRectangle(cornerRadius: 4)
                            .foregroundStyle(viewModel.borderColor)
                        
                        RoundedRectangle(cornerRadius: 3)
                            .foregroundStyle(viewModel.backgroundColor)
                            .padding(2)
                    }
                }
                .shadow(radius: 4)
                .padding()
                .padding(.top, viewModel.safeAreaInsets.top)
                .padding(.trailing, viewModel.safeAreaInsets.right)
                .padding(.bottom, viewModel.safeAreaInsets.bottom)
                .padding(.leading, viewModel.safeAreaInsets.left)
                .positioned(.bottom)
            }
        }
    }
}

private class MenuViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    @Published var title: String? = nil
    @Published var text: String? = nil
    @Published var options: [String] = []
    @Published var isVisible: Bool = false
    
    let borderColor: Color = .gray
    let backgroundColor: Color = .black
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        bind()
    }
    
    private func bind() {
        engine.menus
            .receive(on: DispatchQueue.main)
            .sink { [weak self] menuState in
                if let menuState, menuState.is_visible {
                    self?.load(menu: menuState)
                } else {
                    self?.hide()
                }
            }
            .store(in: &disposables)
    }
    
    private func load(menu: MenuDescriptorC) {
        title = string(from: menu.title)
        text = string(from: menu.text)
                
        let buffer = UnsafeBufferPointer(start: menu.options, count: Int(menu.options_count))
        let items = Array(buffer)
        
        options = items
            .map { string(from: $0.title) ?? "???" }
            .map { "> \($0)" }
        
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
    }
    
    func selectOption(at index: Int) {
        engine.onMenuItemSelection(index: index)
        
        withAnimation {
            isVisible = false
        }
    }
}
