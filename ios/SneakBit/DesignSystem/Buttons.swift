import SwiftUI

enum CustomButtonStyle {
    case messageOption
    case menuOption
    case destructiveMenuOption
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
        case .messageOption: content.buttonStyle(MessageButton())
        case .menuOption: content.buttonStyle(MenuOptionButton())
        case .destructiveMenuOption: content.buttonStyle(DestructiveMenuOptionButton())
        }
    }
}

private struct DestructiveMenuOptionButton: ButtonStyle {
    @SwiftUI.Environment(\.isEnabled) private var isEnabled: Bool
    
    func makeBody(configuration: Self.Configuration) -> some View {
        configuration.label
            .multilineTextAlignment(.center)
            .typography(.optionsItem)
            .foregroundColor(Color.red)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background(Color.clear)
            .contentShape(Rectangle())
            .opacity(isEnabled || configuration.isPressed ? 1 : 0.6)
    }
}

private struct MenuOptionButton: ButtonStyle {
    @SwiftUI.Environment(\.isEnabled) private var isEnabled: Bool
    
    func makeBody(configuration: Self.Configuration) -> some View {
        configuration.label
            .multilineTextAlignment(.center)
            .typography(.optionsItem)
            .foregroundColor(Color.white)
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .background(Color.clear)
            .contentShape(Rectangle())
            .opacity(isEnabled || configuration.isPressed ? 1 : 0.6)
    }
}

private struct MessageButton: ButtonStyle {
    @SwiftUI.Environment(\.isEnabled) private var isEnabled: Bool
    
    func makeBody(configuration: Self.Configuration) -> some View {
        HStack {
            configuration.label.multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .typography(.menuOption)
        .foregroundColor(Color.highlightedText)
        .frame(maxWidth: 400)
        .frame(height: 40)
        .background(Color.clear)
        .contentShape(Rectangle())
        .opacity(isEnabled || configuration.isPressed ? 1 : 0.6)
    }
}
