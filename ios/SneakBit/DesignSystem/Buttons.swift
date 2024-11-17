import SwiftUI

enum CustomButtonStyle {
    case menuOption
}

extension View {
    func buttonStyle(_ style: CustomButtonStyle) -> some View {
        modifier(ButtonStyleMod(style: style))
    }
}

private struct ButtonStyleMod: ViewModifier {
    let style: CustomButtonStyle
    
    func body(content: Content) -> some View {
        switch style {
        case .menuOption: content.buttonStyle(MenuOptionButton())
        }
    }
}

private struct MenuOptionButton: ButtonStyle {
    @SwiftUI.Environment(\.isEnabled) private var isEnabled: Bool
    
    func makeBody(configuration: Self.Configuration) -> some View {
        HStack {
            configuration.label.multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .typography(.menuOption)
        .foregroundColor(Color.yellow)
        .frame(maxWidth: 400)
        .frame(height: 40)
        .background(Color.clear)
        .contentShape(Rectangle())
        .opacity(isEnabled || configuration.isPressed ? 1 : 0.6)
    }
}
