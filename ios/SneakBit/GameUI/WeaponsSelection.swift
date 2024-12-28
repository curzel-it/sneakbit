import Foundation
import SwiftUI
import Schwifty

struct SwitchWeaponView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        VStack(spacing: 20) {
            Text("switch_weapon".localized())
                .typography(.largeTitle)
                .foregroundStyle(Color.white)
                .padding(.top, 100)
            
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
            
            Text(String(cString: weapon.weapon_name))
                .foregroundColor(.white)
                .padding()
        }
        .padding()
        .background(Color.gray.opacity(0.5))
        .cornerRadius(10)
        .onTapGesture {
            viewModel.selectWeapon(weapon)
        }
    }
}
