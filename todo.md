Js port replaces Rust codebase in production via Electron or similar, across all platforms
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support
- [ ] Local co-op with up to 4 players (currently limited to 2)
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support    
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was

New game mode: online co-op (spec: host-authoritative-server.md)
- [x] Phase 1: WS relay (server/ws*.js + sessions.js + relay.js)
- [x] Phase 2: client networking (js/net.js + onlineMode.js + onlineBootstrap.js)
- [x] Phase 3: host snapshot broadcaster
- [x] Phase 4: guest mirror world + rendering
- [x] Phase 5: guest input forwarding + host injection
- [x] Phase 6: prediction + reconciliation
- [x] Phase 7: action intents + toast event framework (pickup/death/dialogue/cutscene events still TODO)
- [x] Phase 8: zone transitions
- [x] Phase 9: party panel, connection toasts, guest creative-mode gate
- [ ] Hook event:pickup into pickups.js so guest inventory matches host
- [ ] Hook event:death / respawn / dialogue / cutscene into host emitters and guest UI
- [ ] Extend hostGuests beyond slot 2 (P3 / P4) once main.js gains state.players[]
- [ ] Touch / mobile pass on the party panel and join form
- [ ] Production deploy of the relay (server.curzel.it/ws) + nginx + TLS

