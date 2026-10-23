---
'@forinda/kickjs-vite': minor
---

`kick build` writes client-script files (entries, chunks, CSS, images and fonts over 4 KB) to `dist/public/_kick/c/` instead of the server bundle; `virtual:kick-views` exports `clientDir`. Edge deployments now need the platform to serve `dist/public` (Cloudflare: `assets.directory`), or set `clientFiles: 'bundle'`. Needs `@forinda/kickjs-view` 0.3 or later in disk mode; the build says so otherwise. New `views` options: `clientFiles` (`'disk'` default, `'bundle'` keeps everything in the server bundle and inlines every asset), `publicDir` (default `'public'`), `inlineLimit` (default `4096`).
