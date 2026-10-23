---
'@forinda/kickjs-vite': minor
---

`kick build` writes client-script files (entries, chunks, CSS, images and fonts over 4 KB) to `dist/public/_kick/c/` instead of the server bundle; `virtual:kick-views` exports `clientDir`. New `views` options: `clientFiles` (`'disk'` default, `'bundle'` keeps everything in the server bundle and inlines every asset), `publicDir` (default `'public'`), `inlineLimit` (default `4096`).
