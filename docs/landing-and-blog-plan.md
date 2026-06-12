# Landing page + static devlog — plan (Option A)

Status: **planning** · Owner: Federico · Last updated: 2026-06-12

## Goal

Give SneakBit a real front door. Today the domain root *is* the game canvas;
an outsider who clicks a link lands in a running game with no context, no pitch,
no store badges. We add:

1. A **landing page** at `/` (hero, one-line pitch, store badges, "Play" button).
2. A **static devlog** at `/blog` (flat Markdown → HTML, no CMS, no DB).
3. The **game moves to `/play`**.

This is "Option A" from the discussion: marketing owns `/`, the game gets its own
path. We accept a one-time change to the game's URL in exchange for a root that
actually sells the game.

Out of scope: any self-hosted community/forum. Community = link out to Discord /
Steam hub (zero infra). Not built here.

## URL map

| URL | Before | After |
|---|---|---|
| `/` | the game | **landing page** |
| `/play` | (404 → fell back to game) | **the game** |
| `/blog`, `/blog/<slug>` | (fell back to game) | **devlog** |
| `/privacy.html`, `/terms.html` | static | static (unchanged) |
| `/ws`, `/health`, `/auth/…`, `/saves`, `/store`, `/webhooks/stripe`, … | Node | Node (unchanged) |
| any unknown path | fell back to **game** | falls back to **landing** |

Note the nice side effect: with the landing as the SPA fallback, an unknown URL
now lands on marketing instead of dumping the visitor into the game.

## The one real gotcha: relative asset paths

The game loads assets/data with **document-relative** URLs:

- `js/assets.js` → `"./assets/heroes.png"`, etc.
- `js/data.js` → `` `./data/${id}.json` ``, `"./data/species.json"`, `` `./data/strings.${lang}.json` ``

These resolve against the document's base URL. If the game HTML is served from
`/play/`, `./data/x.json` resolves to `/play/data/x.json` — **broken**, because
assets ship at root. We do **not** want to duplicate `assets/` and `data/` under
`/play/`.

**Fix:** add `<base href="/">` to the game's HTML shell. Then, no matter what
path the game is served from:

- `./assets/…` → `/assets/…` ✓
- `./data/…` → `/data/…` ✓
- `./js/main.js` (dev) / `./app-<hash>.js` (prod) → root ✓

Verified safe — a `<base>` tag only affects relative URL *resolution* in markup
and one-arg `fetch`/`new URL`. It does **not** touch:

- `location.*` derivations (`new URL(location.href)` in clipboard.js, storeBoot.js,
  switchRole.js, accountPanel.js) — explicit base, unaffected.
- `new WebSocket(...)` (net.js) and the API base (`apiBase.js` → absolute
  `https://sneakbit.curzel.it` or query-param override) — absolute, unaffected.

The *only* document-relative fetches in the codebase are `./data/` and `./assets/`,
which is exactly what we want `<base href="/">` to repoint at root.

## Source layout changes

Keep dev and prod URLs **identical** by mirroring the prod path in the repo:

```
index.html            ← NEW: the landing page (static, no JS bundle)
play/index.html       ← MOVED here from root index.html; gains <base href="/">
blog/                 ← NEW: generated output + source posts (see below)
  posts/*.md          ← source Markdown (one file per post)
  _template.html      ← shared post/list shell
privacy.html          ← unchanged
terms.html            ← unchanged
js/, assets/, data/   ← unchanged, still at root
```

Dev (serve.mjs serves repo root): game at `/play/`, landing at `/`. Prod: same.
No dev/prod URL mismatch.

## Build changes (`tools/build.mjs`)

Today build.mjs: bundles `js/main.js` → `_site/app-<hash>.js`, copies every
non-denylisted root entry verbatim, then rewrites root `index.html`'s
`./js/main.js` → `./app-<hash>.js`.

Changes:

1. **Stop special-casing root `index.html` as the game.** Root `index.html` is
   now the static landing — copy it verbatim (no rewrite).
2. **Rewrite `play/index.html` instead.** Replace its `./js/main.js` with the
   hashed bundle, write to `_site/play/index.html`. Keep the "throw if the script
   tag wasn't found" guard so an entry-path change fails loudly.
3. **Generate the blog** (see next section) into `_site/blog/`.
4. The verbatim copy loop already ships `play/` and `blog/` sources; make sure we
   don't *also* ship `blog/posts/*.md` raw — either keep `.md` denied (it already
   is: `isDenied` rejects `*.md`) or build blog output to a separate dir. The
   existing `*.md` deny means raw posts won't ship; good, but confirm the
   generated `blog/*.html` lands in `_site/blog/`.

Decision needed: generate blog inside build.mjs, or a separate `tools/blog.mjs`
that build.mjs calls? Leaning **separate file** (`tools/buildBlog.mjs`) per the
"one feature one file" rule — build.mjs orchestrates, blog gen is its own feature.

## nginx changes (`tools/deploy.mjs`)

The `SNEAKBIT_NGINX_HTTP` template's static block is:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

`try_files` already does the right thing for Option A with **no change**:

- `/play` → no file `/play`, then `/play/` → `/play/index.html` (the game) ✓
- `/blog/post` → `/blog/post.html`? **No** — `$uri` is `/blog/post`, not
  `/blog/post.html`. It would fall through to `/index.html` (landing). So
  **clean/extensionless blog URLs need an explicit block** OR we ship posts as
  `/blog/<slug>.html` and link to them with the `.html` extension.

Two choices for blog URLs:

- **(simple, no nginx change)** ship `/blog/<slug>.html`, link with `.html`.
  Works today via `try_files $uri`.
- **(clean URLs)** add ahead of `location /`:
  ```nginx
  location /blog/ { try_files $uri $uri.html $uri/ =404; }
  ```
  Gives `/blog/<slug>` and a real 404 for missing posts instead of the landing.

Recommend starting with the **simple** option (`.html` links) to ship zero nginx
risk, and upgrade to clean URLs later if we care.

The regex backend block (`^/(ws|health|…)`) is untouched — none of `play`/`blog`
collide with it.

## Dev loop + e2e changes

E2E and tooling currently navigate to `/index.html`. Moving the game breaks them.
**Must update** every game-URL reference from `…/index.html` to `…/play/`:

- `tests/e2e/account.test.mjs` (several: `/index.html?api=…`)
- `tests/e2e/allocProfile.mjs` (`/index.html?zone=…`)
- `tests/e2e/allocations.test.mjs`
- `tests/e2e/coinEconomy.test.mjs`
- `tests/e2e/controllerPresence.test.mjs`
- `tests/e2e/i18nFullscreen.test.mjs`
- …grep `tests/` for `/index.html` to get the full set.

Query strings still work: `…/play/?api=…`, `…/play/?zone=…`.

`tools/serve.mjs` needs no change — it already serves the repo root and resolves
`/play/` → `play/index.html` via its directory-index logic.

Per CLAUDE.md, this touches none of the netcode files, but it **does** move the
game entry, so **run `npm run test:e2e`** after the move to prove the game still
boots at `/play/`.

## Landing page content (first cut)

Single static HTML file, no bundle, matching the dark monospace style of
`privacy.html` (`:root { color-scheme: dark }`, `ui-monospace` stack, `#9ab1ff`
links). Sections:

- Hero: title, one-line pitch, a looping gameplay GIF/screenshot.
- Primary CTA: **Play in browser** → `/play`.
- Store badges (links confirmed, source: <https://curzel.it/sneakbit>):
  - Steam — <https://store.steampowered.com/app/3360860/SneakBit/> (appid `3360860`)
  - App Store — <https://apps.apple.com/app/sneakbit/id6737452377>
  - Google Play — <https://play.google.com/store/apps/details?id=it.curzel.bitscape>
- Short feature blurb (co-op, creative mode, etc.).
- Footer: links to `/blog`, GitHub, privacy/terms, credits (mirror menu.js
  attributions: Filippo Vicarelli music, SubspaceAudio SFX, PixelOperator font).

Reuse an existing screenshot from `tools/screenshots.json` / `docs/screenshots/`
for the hero rather than shooting a new one.

## Blog: static generation

- One Markdown file per post under `blog/posts/<slug>.md`, with frontmatter
  (title, date, summary).
- `tools/buildBlog.mjs`: read posts → render to HTML via a tiny dependency-free
  Markdown pass (or accept a single build-time dep if we want real Markdown —
  **decision needed**, see open questions; CLAUDE.md allows build-time deps,
  only the *runtime* must stay lib-free).
- Output: `_site/blog/index.html` (reverse-chronological list) +
  `_site/blog/<slug>.html` per post, both wrapping `_template.html`.
- Cross-post-friendly: a post's HTML should be copy-pasteable into a Steam
  announcement.

## Old-link handling

Links to `/` (Steam store page, social, bookmarks) now hit the **landing**, which
has a prominent "Play" button → `/play`. That's a one-click detour, not a break —
acceptable. No redirect needed. (If we later want `/` → straight-to-game for
returning players, that's a product call, not a technical one.)

## Decisions

- **Repo path style** — ✅ mirror prod in the repo (`play/index.html`), so dev
  and prod URLs are identical.
- **Store badge links** — ✅ resolved (see Landing page content above).

## Open questions

1. **Markdown rendering** — tiny hand-rolled subset (zero deps) vs. one build-time
   dep (e.g. `marked`)? Runtime stays lib-free either way.
2. **Blog URL style** — ship `.html` (no nginx change) now, or go clean-URL
   (`location /blog/`) from the start?
3. **Hero asset** — reuse an existing screenshot, or capture a fresh GIF via the
   screenshot tool?

## Phasing / checklist

- [ ] Phase 0 — confirm remaining open questions (blog: Markdown approach + URL
      style + hero asset). Not blocking Phase 1.
- [ ] Phase 1 (game move, no new content):
  - [ ] `git mv index.html play/index.html`; add `<base href="/">`.
  - [ ] Update `build.mjs` to rewrite `play/index.html`, copy a new root
        `index.html` verbatim.
  - [ ] Stand up a minimal placeholder landing at `/` ("SneakBit — Play").
  - [ ] Update all e2e `/index.html` → `/play/` refs.
  - [ ] `npm run test:unit && npm run test:e2e` green; `npm run build` produces
        `_site/play/index.html` + `_site/index.html`.
  - [ ] Deploy to staging-ish / verify `/play` boots and assets load (the
        `<base>` fix), `/` shows the placeholder.
- [ ] Phase 2 (real landing): hero, badges, copy, footer.
- [ ] Phase 3 (blog): `tools/buildBlog.mjs`, template, first post; decide URL style.
- [ ] Phase 4 (optional): clean blog URLs via nginx `location /blog/`.

Each phase leaves `main` healthy (`npm test` green, page loads clean) and ships
only when we run `npm run deploy`.
