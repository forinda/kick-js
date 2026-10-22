---
'@forinda/kickjs-view-language-server': patch
---

- Open and edited buffers count from the moment they change, and closing one without saving re-checks the open templates that used it. Before, a page could keep an error about a component whose buffer hadn't synced yet, or about one that was gone.
- The project's `@forinda/kickjs-view` is found through nested conditions in its exports map (`"import": { "default": "./dist/index.js" }`).
- The standalone server's fallback warning names the version of the `@forinda/kickjs-view` installed beside it, not the one it was built against.
