import Combine
import FirebaseAnalytics
import Foundation

class FirebaseAnalyticsService {
    @Inject private var broker: RuntimeEventsBroker
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.bindEvents()
        }
    }
    
    private func bindEvents() {
        broker.events()
            .sink { self.handle($0) }
            .store(in: &self.disposables)
    }
    
    private func handle(_ event: RuntimeEvent) {
        if let event = event.toAnalyticsEvent() {
            send(event)
        }
    }
    
    private func send(_ event: AnalyticsEvent) {
        Analytics.logEvent(event.name, parameters: event.params)
    }
}

private extension RuntimeEvent {
    func toAnalyticsEvent() -> AnalyticsEvent? {
        switch self {
        case .loading: .init(name: "app_loading")
        case .launched: .init(name: "app_launched")
        case .willEnterForeground: .init(name: "will_enter_foreground")
        case .didEnterBackground: .init(name: "did_enter_background")
        case .newGame: .init(name: "new_game_started")
        case .gameOver:
            .init(
                name: "game_over",
                params: [
                    "current_world": current_world_id(),
                    "kunai_count": ammo_in_inventory_for_weapon(UInt32(SPECIES_KUNAI_LAUNCHER), 0),
                    "rem223_count": ammo_in_inventory_for_weapon(UInt32(SPECIES_AR15), 0),
                    "cannonball_count": ammo_in_inventory_for_weapon(UInt32(SPECIES_CANNON), 0)
                ]
            )
        case .worldTransition(let source, let destination):
            if source != 0 {
                .init(
                    name: "world_transition",
                    params: [
                        "source": source,
                        "destination": destination
                    ]
                )
            } else {
                nil
            }
        }
    }
}

private struct AnalyticsEvent {
    let name: String
    let params: [String: Any]?
    
    init(name: String, params: [String: Any]? = nil) {
        self.name = name
        self.params = params
    }
}
