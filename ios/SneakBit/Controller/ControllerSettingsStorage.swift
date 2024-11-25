import Foundation
import Schwifty

protocol ControllerSettingsStorage {
    func store(offset: CGFloat, axis: ControllerOffsetAxis, orientation: ControllerOrientation)
    func offset(axis: ControllerOffsetAxis, orientation: ControllerOrientation) -> CGFloat
}

enum ControllerOrientation {
    case portrait
    case landscape
}

enum ControllerOffsetAxis {
    case x
    case y
}

class ControllerSettingsStorageImpl: ControllerSettingsStorage {
    private var defaults: UserDefaults {
        UserDefaults.standard
    }
    
    init() {
        if !didSetDefaults() {
            loadDefaults()
            defaults.set(true, forKey: kControllerOffsetDidSetDefaults)
        }
    }
    
    func store(offset: CGFloat, axis: ControllerOffsetAxis, orientation: ControllerOrientation) {
        defaults.set(Float(offset), forKey: key(axis: axis, orientation: orientation))
    }
    
    func offset(axis: ControllerOffsetAxis, orientation: ControllerOrientation) -> CGFloat {
        CGFloat(defaults.float(forKey: key(axis: axis, orientation: orientation)))
    }
    
    private func key(axis: ControllerOffsetAxis, orientation: ControllerOrientation) -> String {
        switch (axis, orientation) {
        case (.x, .portrait): kControllerOffsetPortraitX
        case (.y, .portrait): kControllerOffsetPortraitY
        case (.x, .landscape): kControllerOffsetLandscapeX
        case (.y, .landscape): kControllerOffsetLandscapeY
        }
    }
    
    private func didSetDefaults() -> Bool {
        defaults.bool(forKey: kControllerOffsetDidSetDefaults)
    }
    
    private func loadDefaults() {
        let width = min(Screen.main?.bounds.width ?? 0, Screen.main?.bounds.height ?? 0)
        let height = max(Screen.main?.bounds.width ?? 0, Screen.main?.bounds.height ?? 0)
        
        store(offset: width / 2 - KeyEmulatorView.size.width, axis: .x, orientation: .portrait)
        store(offset: height / 2 - KeyEmulatorView.size.height - 150, axis: .y, orientation: .portrait)
        
        store(offset: height / 2 - KeyEmulatorView.size.width - 40, axis: .x, orientation: .landscape)
        store(offset: width / 2 - KeyEmulatorView.size.height - 100, axis: .y, orientation: .landscape)
    }
}

private let kControllerOffsetDidSetDefaults = "kControllerOffsetDidSetDefaults"
private let kControllerOffsetPortraitX = "kControllerOffsetPortraitX"
private let kControllerOffsetPortraitY = "kControllerOffsetPortraitY"
private let kControllerOffsetLandscapeX = "kControllerOffsetLandscapeX"
private let kControllerOffsetLandscapeY = "kControllerOffsetLandscapeY"
