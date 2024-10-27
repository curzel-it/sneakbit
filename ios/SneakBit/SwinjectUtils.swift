import Foundation
import Swinject

extension Container {
    @discardableResult
    func registerSingleton<Service>(
        _ serviceType: Service.Type,
        name: String? = nil,
        factory: @escaping (Resolver) -> Service
    ) -> ServiceEntry<Service> {
        _register(serviceType, factory: factory, name: name)
            .inObjectScope(.container)
    }
    
    @discardableResult
    func registerEagerSingleton<Service>(_ serviceType: Service.Type, factory: @escaping () -> Service) -> ServiceEntry<Service> {
        registerEagerSingleton(serviceType, factory())
    }
    
    @discardableResult
    func registerEagerSingleton<Service>(_ serviceType: Service.Type, _ instance: Service) -> ServiceEntry<Service> {
        registerSingleton(serviceType) { _ in instance }
    }
    
    @discardableResult
    func registerEagerSingleton<Service>(_ instance: Service) -> ServiceEntry<Service> {
        registerEagerSingleton(Service.self, instance)
    }
}

extension Container {
    static var main: Resolver!
}

@propertyWrapper
class Inject<Value> {
    private var storage: Value?

    init() {}

    var wrappedValue: Value {
        storage ?? {
            guard let resolver = Container.main else {
                fatalError("Missing call to `Dependencies.setup()`")
            }
            guard let value = resolver.resolve(Value.self) else {
                fatalError("Dependency `\(Value.self)` not found, register it in `Dependencies.setup()`")
            }
            storage = value
            return value
        }()
    }
}
