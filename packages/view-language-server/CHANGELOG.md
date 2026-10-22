# @forinda/kickjs-view-language-server

## 0.1.2

### Patch Changes

- [#1026](https://github.com/forinda/kick-js/pull/1026) [`a4eea95`](https://github.com/forinda/kick-js/commit/a4eea95444a08ebe4d9b548a025ff4f018991f01) Thanks [@forinda](https://github.com/forinda)! - Any file ending in `.kick` is treated as a template, whatever `languageId` the editor sends. Before, a client that sent `html` or `plaintext` got no diagnostics, completion or formatting at all, which is what most editors do unless you configure a language ID. New guide: setting up `kick-view-ls --stdio` in Neovim, Vim, Helix, Emacs and JetBrains IDEs.

## 0.1.1

### Patch Changes

- [#1022](https://github.com/forinda/kick-js/pull/1022) [`2ad46ed`](https://github.com/forinda/kick-js/commit/2ad46ed94ecffe121ca0fa117fc6c9144cfbdb71) Thanks [@forinda](https://github.com/forinda)! - - Open and edited buffers count from the moment they change, and closing one without saving re-checks the open templates that used it. Before, a page could keep an error about a component whose buffer hadn't synced yet, or about one that was gone.
  - The project's `@forinda/kickjs-view` is found through nested conditions in its exports map (`"import": { "default": "./dist/index.js" }`).
  - The standalone server's fallback warning names the version of the `@forinda/kickjs-view` installed beside it, not the one it was built against.

## 0.1.0

### Minor Changes

- [#1015](https://github.com/forinda/kick-js/pull/1015) [`0238c86`](https://github.com/forinda/kick-js/commit/0238c86c2be644903bafed2fa159d7824d2a7bbf) Thanks [@forinda](https://github.com/forinda)! - New, experimental: a language server for `.kick` views. Diagnostics, completion, hover, go to definition and formatting come from the project's own `@forinda/kickjs-view`; HTML, CSS and Emmet work inside templates. Run it with `kick-view-ls --stdio`; the KickJS VS Code extension bundles it.

### Patch Changes

- Updated dependencies [[`5bffa66`](https://github.com/forinda/kick-js/commit/5bffa66befe08d3e2385e5dad989c0b85fad6434), [`996c968`](https://github.com/forinda/kick-js/commit/996c968b79b79b961584660cee4f6cef1e8ddedd)]:
  - @forinda/kickjs-view@0.1.0
