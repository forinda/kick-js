# @forinda/kickjs-view-language-server

## 0.4.0

### Minor Changes

- [#1052](https://github.com/forinda/kick-js/pull/1052) [`d2c3568`](https://github.com/forinda/kick-js/commit/d2c356828abb268dc520e57c16e9e8957a9ecfe0) Thanks [@forinda](https://github.com/forinda)! - The app's validators from `validators.ts` count in diagnostics, and validator names, built-in and the app's, are completed inside `validate="…"`. The file is watched like `pipes.ts`; `validatorsFile` moves it.

### Patch Changes

- Updated dependencies [[`d2c3568`](https://github.com/forinda/kick-js/commit/d2c356828abb268dc520e57c16e9e8957a9ecfe0), [`772b563`](https://github.com/forinda/kick-js/commit/772b56357a95f1044732ba871e4212893fe258ae), [`f00cbf2`](https://github.com/forinda/kick-js/commit/f00cbf2a91d7fa1702aa310bc841c8c425070fda)]:
  - @forinda/kickjs-view@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`2ab6a74`](https://github.com/forinda/kick-js/commit/2ab6a746dd2df28192280a33027208bcd01a3659), [`a90596b`](https://github.com/forinda/kick-js/commit/a90596b3577f1f2a4d8fc34760254ae7a2eaa328)]:
  - @forinda/kickjs-view@0.3.0

## 0.3.0

### Minor Changes

- [#1036](https://github.com/forinda/kick-js/pull/1036) [`4e7b07b`](https://github.com/forinda/kick-js/commit/4e7b07b54147aba8ca04eee2964848885575da24) Thanks [@forinda](https://github.com/forinda)! - `@error('field')` is highlighted and completed, with `$message` in scope inside it, and `$errors`, `$old` and `$flash` complete in every template.

### Patch Changes

- [#1038](https://github.com/forinda/kick-js/pull/1038) [`e5bfa90`](https://github.com/forinda/kick-js/commit/e5bfa90f2600c621f86d9e8386f6d6f1046433a6) Thanks [@forinda](https://github.com/forinda)! - `<script client>` blocks are embedded as TypeScript rather than JavaScript.
- Updated dependencies [[`e5bfa90`](https://github.com/forinda/kick-js/commit/e5bfa90f2600c621f86d9e8386f6d6f1046433a6), [`4e7b07b`](https://github.com/forinda/kick-js/commit/4e7b07b54147aba8ca04eee2964848885575da24), [`bc7e084`](https://github.com/forinda/kick-js/commit/bc7e084bad20e1f1fbc103517a8f595e4b8223f6)]:
  - @forinda/kickjs-view@0.2.0

## 0.2.0

### Minor Changes

- [#1030](https://github.com/forinda/kick-js/pull/1030) [`bd99617`](https://github.com/forinda/kick-js/commit/bd99617f851891ac355775cf6fea97c6fcf5dba7) Thanks [@forinda](https://github.com/forinda)! - `layout` and `baseLayout` initialization options, the same as `createViews({ layout, baseLayout })`. Pages that declare no `@layout` are checked against the mapped layout and the base layout, as the build does, so their `@slot` blocks no longer warn "has no layout to fill here". Slot completion offers those layouts' slots, and editing a configured layout re-checks every page.

- [#1029](https://github.com/forinda/kick-js/pull/1029) [`e10f5ca`](https://github.com/forinda/kick-js/commit/e10f5caebd21060f3bdd610c87267460003b2796) Thanks [@forinda](https://github.com/forinda)! - Find references and rename. References list every use of a component tag (closing tags included), a layout name or a pipe across templates, with the declaration on request. Rename covers a pipe (its uses and its declaration in `pipes.ts`), a component (every tag, then its file) and a layout (every `@layout('…')`, then its file). Renaming a template file or folder in the editor updates the tags and `@layout('…')` strings that point at it.

- [#1031](https://github.com/forinda/kick-js/pull/1031) [`f2afcef`](https://github.com/forinda/kick-js/commit/f2afcef604920a389ca9c6c252d18057ce2a687e) Thanks [@forinda](https://github.com/forinda)! - TypeScript and JavaScript files: in `ctx.render('…')` and `views.render('…')`, the server completes template names (components left out), goes to the template, and warns "template 'x' not found" for a literal name with no template. It doesn't format, highlight or otherwise touch the rest of the file. Editors attach it to TS and JS files as well as `.kick` to use it.

- [#1028](https://github.com/forinda/kick-js/pull/1028) [`92c3b35`](https://github.com/forinda/kick-js/commit/92c3b3584d4189f652b9d44d0321d285f5290461) Thanks [@forinda](https://github.com/forinda)! - Semantic tokens: the server highlights the template syntax itself, so editors without the VS Code TextMate grammar colour it too. That covers `@if` and the other keywords, `{{ }}` and `|`, names and properties, pipes, component tags, `@input` names, literals and `{{-- --}}` comments, using standard token types so themes colour them. Neovim and JetBrains IDEs (LSP4IJ) show them by default; Zed needs `"semantic_tokens": "combined"` for the Kick language.

### Patch Changes

- [#1033](https://github.com/forinda/kick-js/pull/1033) [`df72c30`](https://github.com/forinda/kick-js/commit/df72c30b20196c529258ee91d2ef5f48f09e3c88) Thanks [@forinda](https://github.com/forinda)! - Renaming a page's `.kick` file or folder updates the `ctx.render('…')` and `views.render('…')` calls that name it. The server scans the project's TS and JS files when the rename happens, skipping `node_modules`, build output, dot folders and `.d.ts`, and uses an open editor's text where there is one.

- [#1032](https://github.com/forinda/kick-js/pull/1032) [`5abe464`](https://github.com/forinda/kick-js/commit/5abe464005ce69f54ac81d71eeefd93a7ae62922) Thanks [@forinda](https://github.com/forinda)! - Custom requests `kick/renderDefinition` (`{ text, offset }`) and `kick/renderDiagnostics` (`{ text }`). They give the `ctx.render('…')` template-name features for a TypeScript or JavaScript file's text, for clients that don't send those files to the server.

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
