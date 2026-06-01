# Contributing

Thanks for considering a contribution!

## Setup

No build step for development. Clone, then serve the folder with any static HTTP server:

```bash
python3 -m http.server 8000
# or
npx http-server -p 8000
```

Open <http://localhost:8000>. It loads the raw ES modules from `js/` — no install needed.

Production is bundled with esbuild (`npm run build` → `_site/`); that's the only
devDependency and you only need it to build a deploy, not to develop or run tests.

## Architecture

One feature, one file. Vanilla ES modules, named exports only, camelCase filenames. See [CLAUDE.md](./CLAUDE.md) for the full guide.

## Tests

```bash
npm test
# or directly
node --test tests/*.test.js
```

Run them before every commit. They're fast — there's no excuse.

## Pull requests

1. Fork and branch from `main`.
2. Keep commits small and focused. Each commit should leave the game runnable (`npm test` green, page loads without console errors).
3. If your change is visible to the user, test it in a browser before opening the PR.
4. Open the PR with a short description of the *why*.

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
