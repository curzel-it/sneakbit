import Combine
import Foundation
import SwiftUI
import Schwifty

struct ControllerEmulatorView: View {
    @StateObject private var viewModel = ControllerEmulatorViewModel()
    
    var body: some View {
        GeometryReader { geo in
            let isLandscape = geo.size.width >= geo.size.height
            
            ZStack {
                JoystickView()
                
                HStack(spacing: .zero) {
                    if !viewModel.confirmOnRightSide(isLandscape) && viewModel.isConfirmVisible {
                        KeyEmulatorView(key: .confirm)
                    }
                    VStack(spacing: 8) {
                        if viewModel.isRangedAttackVisible {
                            KeyEmulatorView(key: .rangedAttack, image: viewModel.rangedAttackImagePrefix)
                                .overlay(
                                    Text(viewModel.attackLabel)
                                        .positioned(.bottom)
                                        .padding(.bottom, 12 + KeyEmulatorView.padding)
                                        .typography(.buttonCaption)
                                        .foregroundStyle(Color.black.opacity(0.9))
                                )
                        }
                        if viewModel.isCloseAttackVisible {
                            KeyEmulatorView(key: .closeRangeAttack)
                        }
                    }
                    if viewModel.confirmOnRightSide(isLandscape) && viewModel.isConfirmVisible {
                        KeyEmulatorView(key: .confirm)
                    }
                }
                .background(Color.clear)
                .offset(viewModel.currentOffset(isLandscape: isLandscape))
                .gesture(
                    LongPressGesture(minimumDuration: 0.2)
                        .sequenced(before: DragGesture())
                        .onChanged { value in
                            switch value {
                            case .first(true): viewModel.isDragging = true
                            case .second(true, let drag?): viewModel.dragOffset = drag.translation
                            default: break
                            }
                        }
                        .onEnded { value in
                            if case .second(true, let drag?) = value {
                                viewModel.updateSavedOffset(
                                    canvasSize: geo.size,
                                    translation: drag.translation,
                                    isLandscape: isLandscape
                                )
                            }
                            viewModel.isDragging = false
                            viewModel.dragOffset = .zero
                        }
                )
                .positioned(.middle)
                .onChange(of: isLandscape) { oldValue, newValue in
                    if oldValue != newValue {
                        viewModel.reloadSettings()
                    }
                }
            }
            .padding(.top, viewModel.safeAreaInsets.top)
            .padding(.bottom, viewModel.safeAreaInsets.bottom)
        }
    }
}

private class ControllerEmulatorViewModel: ObservableObject {
    @Inject private var engine: GameEngine
    @Inject private var settingsStorage: ControllerSettingsStorage
    
    @Published var isConfirmVisible: Bool = false
    @Published var isRangedAttackVisible: Bool = false
    @Published var isCloseAttackVisible: Bool = false
    @Published var rangedAttackImagePrefix: String = ""
    @Published var attackLabel: String = ""
    
    var safeAreaInsets: UIEdgeInsets {
        engine.safeAreaInsets
    }
    
    var isLandscape: Bool {
        engine.isLandscape
    }
    
    @Published var dragOffset: CGSize = .zero
    @Published var isDragging: Bool = false
    @Published private var savedOffsetPortraitX: CGFloat = 0
    @Published private var savedOffsetPortraitY: CGFloat = 0
    @Published private var savedOffsetLandscapeX: CGFloat = 0
    @Published private var savedOffsetLandscapeY: CGFloat = 0
    
    private var disposables = Set<AnyCancellable>()
    
    init() {
        reloadSettings()
        bindAmmo()
        bindMelee()
        bindInteractionAvailable()
    }
    
    func confirmOnRightSide(_ isLandscape: Bool) -> Bool {
        let x = isLandscape ? savedOffsetLandscapeX : savedOffsetPortraitX
        return x < 0
    }
    
    func reloadSettings() {
        savedOffsetPortraitX = settingsStorage.offset(axis: .x, orientation: .portrait)
        savedOffsetPortraitY = settingsStorage.offset(axis: .y, orientation: .portrait)
        savedOffsetLandscapeX = settingsStorage.offset(axis: .x, orientation: .landscape)
        savedOffsetLandscapeY = settingsStorage.offset(axis: .y, orientation: .landscape)
    }
    
    func currentOffset(isLandscape: Bool) -> CGSize {
        if isLandscape {
            return CGSize(width: savedOffsetLandscapeX, height: savedOffsetLandscapeY) + dragOffset
        } else {
            return CGSize(width: savedOffsetPortraitX, height: savedOffsetPortraitY) + dragOffset
        }
    }
    
    func updateSavedOffset(canvasSize: CGSize, translation: CGSize, isLandscape: Bool) {
        let maxX = canvasSize.width / 2 - KeyEmulatorView.size.width
        let maxY = canvasSize.height / 2 - KeyEmulatorView.size.height - 50
        let minX = -canvasSize.width / 2 + KeyEmulatorView.size.width
        let minY = -canvasSize.height / 2 + KeyEmulatorView.size.height * 2
        
        if isLandscape {
            let newX = savedOffsetLandscapeX + translation.width
            let newY = savedOffsetLandscapeY + translation.height
            savedOffsetLandscapeX = max(min(newX, maxX), minX)
            savedOffsetLandscapeY = max(min(newY, maxY), minY)
            settingsStorage.store(offset: savedOffsetLandscapeX, axis: .x, orientation: .landscape)
            settingsStorage.store(offset: savedOffsetLandscapeY, axis: .y, orientation: .landscape)
        } else {
            let newX = savedOffsetPortraitX + translation.width
            let newY = savedOffsetPortraitY + translation.height
            savedOffsetPortraitX = max(min(newX, maxX), minX)
            savedOffsetPortraitY = max(min(newY, maxY), minY)
            settingsStorage.store(offset: savedOffsetPortraitX, axis: .x, orientation: .portrait)
            settingsStorage.store(offset: savedOffsetPortraitY, axis: .y, orientation: .portrait)
        }
    }
    
    private func bindAmmo() {
        engine.weapons()
            .compactMap { weapons in
                return weapons.first { weapon in
                    weapon.is_ranged && weapon.is_equipped
                }
            }
            .map { ($0.weapon_species_id, $0.ammo_inventory_count) }
            .sink { [weak self] weaponId, ammoCount in
                withAnimation {
                    self?.handle(Int32(weaponId), Int32(ammoCount))
                }
            }
            .store(in: &disposables)
    }
    
    private func handle(_ weaponId: Int32, _ ammoCount: Int32) {
        isRangedAttackVisible = ammoCount > 0 && weaponId != 0
        attackLabel = "x\(ammoCount)"
        rangedAttackImagePrefix = buttonImagePrefix(for: weaponId)
    }
    
    private func buttonImagePrefix(for weaponId: Int32) -> String {
        switch weaponId {
        case SPECIES_KUNAI_LAUNCHER: "kunai"
        case SPECIES_AR15, SPECIES_DARKAR15: "rem223"
        case SPECIES_CANNON: "cannonball"
        default: "kunai"
        }
    }
    
    private func bindMelee() {
        engine.weapons()
            .map { weapons in
                return weapons.contains { weapon in
                    weapon.is_melee && weapon.is_equipped
                }
            }
            .sink { [weak self] equipped in
                withAnimation {
                    self?.isCloseAttackVisible = equipped
                }
            }
            .store(in: &disposables)
    }
    
    private func bindInteractionAvailable() {
        engine.gameState()
            .map { $0.is_interaction_available }
            .sink { [weak self] available in
                withAnimation {
                    self?.isConfirmVisible = available
                }
            }
            .store(in: &disposables)
    }
}

extension CGSize {
    static func + (lhs: CGSize, rhs: CGSize) -> CGSize {
        CGSize(width: lhs.width + rhs.width, height: lhs.height + rhs.height)
    }
}
