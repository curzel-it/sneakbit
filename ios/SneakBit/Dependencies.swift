import Swinject

struct Dependencies {
    static func setup() {
        let container = Container()
        container.registerEagerSingleton(GameEngine())
        container.registerEagerSingleton(AudioEngine())
        container.registerSingleton(SpritesProvider.self) { _ in
            MemCachedSpritesProvider(
                spriteSheetFileNames: [
                    UInt32(SPRITE_SHEET_INVENTORY): "inventory",
                    UInt32(SPRITE_SHEET_BIOME_TILES): "tiles_biome",
                    UInt32(SPRITE_SHEET_CONSTRUCTION_TILES): "tiles_constructions",
                    UInt32(SPRITE_SHEET_BUILDINGS): "buildings",
                    UInt32(SPRITE_SHEET_BASE_ATTACK): "baseattack",
                    UInt32(SPRITE_SHEET_STATIC_OBJECTS): "static_objects",
                    UInt32(SPRITE_SHEET_MENU): "menu",
                    UInt32(SPRITE_SHEET_ANIMATED_OBJECTS): "animated_objects",
                    UInt32(SPRITE_SHEET_HUMANOIDS_1X1): "humanoids_1x1",
                    UInt32(SPRITE_SHEET_HUMANOIDS_1X2): "humanoids_1x2",
                    UInt32(SPRITE_SHEET_HUMANOIDS_2X2): "humanoids_2x2",
                    UInt32(SPRITE_SHEET_HUMANOIDS_2X3): "humanoids_2x3",
                    UInt32(SPRITE_SHEET_AVATARS): "avatars",
                    UInt32(SPRITE_SHEET_FARM_PLANTS): "farm_plants",
                    UInt32(SPRITE_SHEET_CAVE_DARKNESS): "cave_darkness"
                ]
            )
        }
        container.register(RenderingScaleUseCase.self) { _ in RenderingScaleUseCaseImpl() }
        container.register(TileMapsStorage.self) { _ in TileMapsStorageImpl() }
        container.register(GameSetupUseCase.self) { _ in GameSetupUseCaseImpl() }
        container.register(ControllerSettingsStorage.self) { _ in ControllerSettingsStorageImpl() }
        Container.main = container.synchronize()
    }
}
