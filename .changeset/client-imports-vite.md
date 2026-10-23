---
'@forinda/kickjs-vite': minor
---

`<script client>` imports. `kick build` runs one browser build of every component's script, so relative imports, the app's aliases and npm packages resolve. Each component gets an entry, and shared code goes into shared chunks. The output ships in the views bundle. Under `kick dev`, the plugin serves component scripts through Vite's dev pipeline, ahead of the app, so imports resolve the same way. Scripts can import CSS (linked by the page after a build) and small assets (inlined as data URIs). The browser build takes the app's `define`, mode, `.env` files and aliases. New option: `clientScriptPath`, exported by `virtual:kick-views` so `createViews({ ...kickViews })` serves from the same path.
