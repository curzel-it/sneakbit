package it.curzel.bitscape.gameui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import it.curzel.bitscape.R
import it.curzel.bitscape.gamecore.AmmoRecap
import it.curzel.bitscape.gamecore.NativeLib
import it.curzel.bitscape.rendering.SpritesProvider
import it.curzel.bitscape.ui.theme.DSTypography

@Composable
fun WeaponSelectionView(
    weapons: List<AmmoRecap>,
    spritesProvider: SpritesProvider,
    onSelectWeapon: (AmmoRecap) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = modifier
            .fillMaxSize()
            .wrapContentHeight(Alignment.CenterVertically)
    ) {
        Text(
            text = stringResource(id = R.string.switch_weapon),
            style = DSTypography.largeTitle,
            color = Color.White,
            modifier = Modifier.padding(top = 20.dp)
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
        ) {
            weapons.forEachIndexed { index, weapon ->
                WeaponCard(
                    weapon = weapon,
                    spritesProvider = spritesProvider,
                    onSelect = { onSelectWeapon(weapon) },
                    modifier = Modifier
                        .padding(start = if (index == 0) 20.dp else 0.dp)
                        .padding(end = if (index == weapons.lastIndex) 20.dp else 0.dp)
                )
            }
        }
        Text(
            text = stringResource(id = R.string.menu_back),
            style = DSTypography.gameMenuOption,
            color = Color.White,
            modifier = Modifier
                .clickable { onClose() }
                .padding(top = 50.dp)
        )
    }
}

@Composable
private fun WeaponCard(
    weapon: AmmoRecap,
    spritesProvider: SpritesProvider,
    onSelect: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clickable { onSelect() }
            .clip(RoundedCornerShape(10.dp))
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .background(Color.Gray.copy(alpha = 0.5f))
                .padding(16.dp)
        ) {
            val weaponImage = spritesProvider.bitmapFor(
                NativeLib.SPRITE_SHEET_WEAPONS,
                weapon.weaponSprite
            )?.asImageBitmap()

            if (weaponImage != null) {
                Image(
                    bitmap = weaponImage,
                    contentDescription = null,
                    filterQuality = FilterQuality.None,
                    modifier = Modifier
                        .size(128.dp)
                )
            }
            Text(
                text = weapon.weaponName,
                color = Color.White,
                style = DSTypography.title,
                modifier = Modifier.padding(top = 12.dp)
            )
            if (weapon.isMelee) {
                Text(
                    text = "",
                    color = Color.White.copy(alpha = 0.8f),
                    style = DSTypography.text,
                    modifier = Modifier.padding(top = 8.dp)
                )
            } else {
                Text(
                    text = "${weapon.bulletName} x ${weapon.ammoInventoryCount}",
                    color = Color.White.copy(alpha = 0.8f),
                    style = DSTypography.text,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}