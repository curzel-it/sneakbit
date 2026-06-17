# Co-op TODO — per-player parity with single-player ✅ done

Goal: in co-op (offline split-screen **and** online), every player gets the same
self-contained experience they'd have in single player. No shared/global state for
inventory or wallet — each player owns their own.

- [x] **1. Per-player inventory** — each player has its own dedicated inventory,
  identical to the inventory they'd have in single player. *(Dropped the local
  co-op fold in inventory.js; online guests were already independent.)*
- [x] **2. NPC interaction** — every player can interact with NPCs. *(Local
  P1..P4 already route per-player; a guest's NPC reward now syncs to its own
  HUD + toast.)*
- [x] **3. Hint interaction** — every player can interact with hints. *(A hint a
  guest walks into is now shown to that guest, not the host.)*
- [x] **4. Shop access** — every player can access the shop: talk to the shop
  clerk, buy items into *their own* inventory, etc. *(Local P1..P4 open the
  host-side modal; a guest opens the buy screen on its own client and the host
  mirrors the bought ammo into its authoritative pool.)*
- [x] **5. Per-player wallet** — every player has its own wallet. *(Dropped the
  local co-op fold in wallet.js; per-player coin HUD chips.)*
- [x] **6. Guest starter sword** — guests entering with **< 5 kunai** and **no
  melee** are automatically gifted a sword. *(starterGift.js — also seeds fresh
  local P2..P4.)*

Shipped across commits: per-player inventory/wallet/equipment (Phase A), starter
sword (Phase B), online shop for guests (Phase C), guest NPC/hint surfacing
(Phase D).
