import Combine
import Foundation

protocol RuntimeEventsBroker {
    func send(_ event: RuntimeEvent)
    func events() -> AnyPublisher<RuntimeEvent, Never>
}

enum RuntimeEvent {
    case loading
    case launched
    case willEnterForeground
    case didEnterBackground
    case gameOver
    case newGame
    case worldTransition(source: UInt32, destination: UInt32)
}

class RuntimeEventsBrokerImpl: RuntimeEventsBroker, Loggable {
    private let latestEvent = CurrentValueSubject<RuntimeEvent, Never>(.loading)
    
    func send(_ event: RuntimeEvent) {
        latestEvent.send(event)
        log(event)
    }
    
    func events() -> AnyPublisher<RuntimeEvent, Never> {
        latestEvent.eraseToAnyPublisher()
    }
    
    private func log(_ event: RuntimeEvent) {
        log(event.description)
    }
}

extension RuntimeEvent: CustomStringConvertible {
    var description: String {
        switch self {
        case .loading: "Loading..."
        case .launched: "Launched!"
        case .willEnterForeground: "Entering foreground"
        case .didEnterBackground: "Entered background"
        case .gameOver: "Game Over"
        case .newGame: "Started new game"
        case .worldTransition(let source, let destination): "World changed from \(source) to \(destination)"
        }
    }
}
