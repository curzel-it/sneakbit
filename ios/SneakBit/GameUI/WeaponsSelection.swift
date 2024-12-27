import Foundation
import SwiftUI
import Schwifty

struct SwitchWeaponView: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    
    var body: some View {
        VStack(spacing: 20) {
            Text("select_weapon".localized())
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
            
            Button(action: {
                print("Back button tapped")
                viewModel.closeWeaponSelection()
            }) {
                Text("menu_back".localized())
                    .foregroundColor(.white)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(Color.blue.opacity(0.7))
                    .cornerRadius(10)
            }
            .padding(.horizontal, 50)
            .padding(.top, 50)
        }
        .typography(.title)
        .foregroundStyle(Color.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.7)) // Optional: Add a background to ensure visibility
    }
}

private struct WeaponCard: View {
    @EnvironmentObject var viewModel: OptionsViewModel
    let weapon: AmmoRecap
    
    var body: some View {
        VStack {
            // Placeholder for weapon image if available
            // Uncomment and adjust if you have images matching weapon names
            /*
            Image(String(cString: weapon.weapon_name))
                .resizable()
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            */
            
            Text(String(cString: weapon.weapon_name))
                .foregroundColor(.white)
                .padding()
                .background(Color.gray.opacity(0.5))
                .cornerRadius(10)
        }
        .frame(width: 150, height: 150)
        .onTapGesture {
            print("Weapon '\(String(cString: weapon.weapon_name))' selected")
            viewModel.selectWeapon(weapon)
        }
    }
}
