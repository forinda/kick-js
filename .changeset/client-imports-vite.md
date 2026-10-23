---
'@forinda/kickjs-vite': minor
---

`<script client>` imports. `kick build` runs one browser build of every component's script, so relative imports, the app's aliases and npm packages resolve. Each component gets an entry, and shared code goes into shared chunks. The output ships in the views bundle. Under `kick dev`, the plugin serves component scripts through Vite's dev pipeline, ahead of the app, so imports resolve the same way. New option: `clientScriptPath`.
