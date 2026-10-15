---
'@forinda/kickjs-cli': patch
---

`kick add` no longer appends a layer's source file to an existing one with other contents, which duplicated declarations (`src/storage.ts` for `kick add storage`). The app's file is kept and the wiring that imports it is printed for a manual merge. `.env`, `.env.example` and `.gitignore` still gain their missing lines.
