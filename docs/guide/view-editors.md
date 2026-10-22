# `.kick` in other editors

The VS Code extension bundles the `.kick` language server. Any editor with an LSP client can run the same server directly: errors as you type, completion, hover, go to definition and formatting all come from it, not from the extension.

## The server

```bash
pnpm add -D @forinda/kickjs-view-language-server
npx kick-view-ls --stdio
```

- It speaks LSP over stdio. Start it from the project root, or send the project as the workspace folder. It reads the first workspace folder only.
- It treats any file ending in `.kick` as a template, whatever language ID the editor sends. Send `kick` when your editor lets you choose.
- It watches templates and the pipes file itself (`workspace/didChangeWatchedFiles`), so saving a component re-checks the pages that use it.

### Highlighting

The server sends semantic tokens for the template syntax: `@if` and the other keywords, `{{ }}` and `|`, names and properties, pipes, component tags, `@input` names, strings, numbers and `{{-- --}}` comments. They use standard token types, so your theme colours them. Editors that show semantic tokens highlight templates without a grammar:

- **Neovim:** on by default.
- **JetBrains IDEs (LSP4IJ):** on by default.
- **Zed:** off by default. Turn it on for `.kick` files in your settings: `"languages": { "Kick": { "semantic_tokens": "combined" } }`.
- **Helix:** doesn't support semantic tokens, so only the HTML grammar applies.

### Initialization options

Every editor below passes these as `initializationOptions`. Paths are relative to the workspace folder.

| option          | default               |                                                                                        |
| --------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `viewsDir`      | `src/views`           |                                                                                        |
| `componentsDir` | `components`          | inside `viewsDir`                                                                      |
| `pipesFile`     | `<viewsDir>/pipes.ts` |                                                                                        |
| `trusted`       | `false`               | `true` loads the project's own `@forinda/kickjs-view`, which runs its code. See below. |

**`trusted`:** with `true`, the server imports your installed `@forinda/kickjs-view`, so the editor checks and formats exactly as your build does. With `false`, it uses the copy bundled with the server, which may be a different version. Set `true` only for projects whose dependencies you trust: the VS Code extension sends it only for trusted workspaces.

::: warning Keep `trusted` out of project files
Set `trusted` only in your own editor config: `init.lua`, `~/.config/helix/languages.toml`, your global `coc-settings.json` and so on. Some editors also read config from the project, like `.helix/languages.toml` or `.vim/coc-settings.json`. A repository you clone could ship one with `trusted: true` and run its code when you open a `.kick` file.
:::

## Neovim

Neovim 0.11 or later, no plugins:

```lua
vim.filetype.add({ extension = { kick = 'kick' } })
-- HTML highlighting for the markup; the template syntax isn't highlighted.
vim.treesitter.language.register('html', 'kick')

vim.lsp.config('kick_views', {
  cmd = { 'npx', 'kick-view-ls', '--stdio' },
  filetypes = { 'kick' },
  root_markers = { 'kick.config.ts', 'package.json' },
  init_options = { trusted = true },
})
vim.lsp.enable('kick_views')
```

## Vim

Both setups below need `.kick` files to have the `kick` filetype, in your `vimrc`:

```vim
autocmd BufNewFile,BufRead *.kick setfiletype kick
```

With [vim-lsp](https://github.com/prabirshrestha/vim-lsp):

```vim
autocmd User lsp_setup call lsp#register_server({
  \ 'name': 'kick-views',
  \ 'cmd': {server_info -> ['npx', 'kick-view-ls', '--stdio']},
  \ 'allowlist': ['kick'],
  \ 'initialization_options': {'trusted': v:true},
  \ })
```

With [coc.nvim](https://github.com/neoclide/coc.nvim), in `coc-settings.json`:

```json
{
  "languageserver": {
    "kick-views": {
      "command": "npx",
      "args": ["kick-view-ls", "--stdio"],
      "filetypes": ["kick"],
      "rootPatterns": ["kick.config.ts", "package.json"],
      "initializationOptions": { "trusted": true }
    }
  }
}
```

## Helix

In `~/.config/helix/languages.toml`:

```toml
[language-server.kick-views]
command = "npx"
args = ["kick-view-ls", "--stdio"]
config = { trusted = true }

[[language]]
name = "kick"
scope = "text.html.kick"
file-types = ["kick"]
roots = ["kick.config.ts", "package.json"]
language-id = "kick"
grammar = "html"
language-servers = ["kick-views"]
```

## Emacs

With Eglot (built in since Emacs 29):

```elisp
(define-derived-mode kick-mode html-mode "Kick")
(add-to-list 'auto-mode-alist '("\\.kick\\'" . kick-mode))

(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(kick-mode . ("npx" "kick-view-ls" "--stdio"
                              :initializationOptions (:trusted t)))))
```

Run `M-x eglot` in a `.kick` file, or add `eglot-ensure` to `kick-mode-hook`.

## JetBrains IDEs

With the free [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin, which works in Community editions too:

1. Open **Settings → Languages & Frameworks → Language Servers** and click **+**.
2. **Server:** name it `KickJS Views`, with the command `npx kick-view-ls --stdio`. If `npx` isn't found, use `sh -c "npx kick-view-ls --stdio"`, or `cmd /c npx kick-view-ls --stdio` on Windows.
3. **Mappings → File name patterns:** add `*.kick`, with the language ID `kick`.
4. **Configuration → Initialization options:** `{ "trusted": true }`.

For highlighting, add the VS Code extension's TextMate grammar under **Settings → Editor → TextMate Bundles**: point it at the `extension` folder inside the extension's `.vsix`, which is a zip file.

## Zed

Install the **KickJS Views** extension ([forinda/kickjs-zed](https://github.com/forinda/kickjs-zed)). It registers the `.kick` language with its own pinned HTML grammar for the markup, downloads the language server from npm, and runs it with Zed's Node. Until it's listed in Zed's extension registry, clone the repository and run **zed: install dev extension** on the folder.

Pass options under `lsp.kick-views.initialization_options` in your settings, for example `{ "viewsDir": "app/views" }`. The extension always sends `trusted: false`: Zed merges a project's `.zed/settings.json` into the settings an extension reads, so it can't tell your choice from a cloned repository's.

## Building on top

- **`kick/templateNames`:** a custom request that returns every template name except components. The VS Code extension uses it to complete `ctx.render('…')` in TypeScript.
- **The package as a library:** `@forinda/kickjs-view-language-server` exports the Volar language plugin (`kickLanguagePlugin`), the service plugin (`createKickServicePlugin`), the `Workspace` that tracks templates, components and pipes, and `startServer`. Use them to run the server in-process or to add `.kick` support to another Volar-based server.
- **Highlighting:** the TextMate grammar, scope `text.html.kick`, lives in [`packages/vscode-extension/syntaxes`](https://github.com/forinda/kick-js/tree/main/packages/vscode-extension/syntaxes). `kick.tmLanguage.json` is the base, and three injection grammars add interpolations, control flow and bindings.

## Related

- [Views (`.kick` templates)](./views.md)
