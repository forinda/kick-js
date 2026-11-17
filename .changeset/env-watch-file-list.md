---
'@forinda/kickjs-vite': patch
---

`envWatchPlugin()` now watches the same `.env` files `@forinda/kickjs` loads: the ones `KICKJS_ENV_FILE` names, or `.env.[mode].local`, `.env.[mode]`, `.env.local` and `.env`. Before, it watched a fixed list, so editing `.env.development.local` or a file named in `KICKJS_ENV_FILE` didn't reload `kick dev`.
