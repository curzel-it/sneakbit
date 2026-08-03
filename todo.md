- [x] Completely remove autoplay the autoplay functionality, only keep bare minimum required for testing. Some existing tests might play the game using the autoplay, if it's possible to just make them use a simple algo that'd be great, so we can remove the feature. If heaveily used just skip
- [x] Remove PVP entirely (pvp arena object, pvp arena world, menu entries, game logic, ...)
- [x] world 10754397 x1 y6 piece of wooden floor is missing
- [x] the sword hits behind the player, which was one of the initial requirements, but maybe it does so a bit too effectively. I can hit enemies that are like 2 tiles behind me
- [x] missing "triumph" sound effect when a key is gathered (see ~/dev/sneakbit-rust)
- [x] price for all armor pieces is still 1 coin
- [x] potions are all there, but idk if all are implemented and which are just placeholders... for sure "turning into a giant" is using placeholder assets... maybe better to just to a x2 zoom on hero sprite
- [x] Remove knock back aura from the shop so that i cannot be used in production
- [x] This update will be a complete rewrite of the game. we need a way to preserve previously saved games
- [x] 1009 is supposedly filled with tentacles, but I can't see any. There are other worlds with such tentacles, but still can't see them. (it's just decoration, but we still want ti fixed, it might be just a missing file, idk)
- [x] world 1021 x 114 y~10 there is a scroll which is unreadable (no interact option toast + clicking the button to interact does nothing)
- [x] world 1021 x 125 y~11 there is a green book which is unreadable (no interact option toast + clicking the button to interact does nothing)
- [x] world 1021 x 10 y~28 there is an ice sheet with some ammo, monsters, etc. the thing is easily solvable, but if I don't get the solution immedaitely then players can get stuck. need to add a connection road from x23 y21 to x23 y12
- [x] There is a non-zero chance inventory items are lost when merging save files or reloading the game

## Could be performed by Opus-level coding agent
- [ ] in 1001 if the wizard specifically asks me to talk with the major of aridreach, then that guy could tell me to fetch the key, making it easier to understand what's going on
- [ ] world 1006 some houses are empty

## Must be performed by a human
- [ ] world 1003 shop sprite is missing shadowing around the door
- [ ] world 1003 blue roofs do no look great
- [ ] Full play through single player
- [ ] Full play through co-op
