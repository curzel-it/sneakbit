import Foundation
import SwiftUI
import Schwifty

struct SwitchWeaponView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        VStack {
            Text("switch_weapon".localized())
                .typography(.largeTitle)
                .foregroundStyle(Color.white)
                .padding(.top, 100)
                .padding(.bottom, 30)
            
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 20) {
                    ForEach(viewModel.weapons, id: \.weapon_species_id) { weapon in
                        WeaponCard(weapon: weapon)
                    }
                }
                .padding(.horizontal, 20)
            }
            .frame(height: 200)
            
            Button("menu_back".localized()) {
                viewModel.closeWeaponSelection()
            }
            .buttonStyle(.menuOption)
            .padding(.top, 50)
        }
        .typography(.title)
        .foregroundStyle(Color.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct WeaponCard: View {
    @EnvironmentObject var viewModel: OptionsViewModel
        
    let weapon: AmmoRecap
    
    var body: some View {
        VStack {
            @Inject var sprites: SpritesProvider
            
            let image = sprites.cgImage(
                for: UInt32(SPRITE_SHEET_WEAPONS),
                textureRect: weapon.weapon_sprite
            )
            
            if let image {
                Image(decorative: image, scale: 1.0)
                    .pixelArt()
                    .frame(width: 128, height: 128)
            }
            
            if let name = string(from: weapon.weapon_name) {
                Text(name)
                    .typography(.title)
                    .padding()
            }
            if weapon.is_melee {
                Text("")
            } else {
                Text("\(string(from: weapon.bullet_name) ?? "") x \(weapon.ammo_inventory_count)")
                    .typography(.text)
                    .foregroundStyle(Color.white.opacity(0.8))
            }
        }
        .padding()
        .foregroundColor(.white)
        .background(Color.gray.opacity(0.5))
        .cornerRadius(10)
        .onTapGesture {
            viewModel.selectWeapon(weapon)
        }
    }
}
