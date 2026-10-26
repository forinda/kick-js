# @forinda/kickjs-view-language-server

A language server for KickJS `.kick` views, built on [Volar](https://volarjs.dev/).

- Errors as you type, from the same `parse` + `check` the runtime uses.
- Completion for `@` keywords, pipes, components and their inputs, layout and slot names, and names in scope.
- HTML, CSS and Emmet inside templates.
- Hover, go to definition, find references and formatting.
- Rename pipes, components and layouts across templates; renaming a template file updates its uses, `ctx.render('…')` calls in TS / JS included.
- Semantic tokens, so any LSP editor highlights the template syntax.
- In TypeScript and JavaScript files, template names in `ctx.render('…')` and `views.render('…')`: completion, go to definition, and a warning for a name with no template. Nothing else in those files is touched.

When the client says the workspace is trusted, it loads the project's own `@forinda/kickjs-view` so the editor agrees with the build, and falls back to its bundled copy (with one warning) when the project has none.

## Use

The KickJS VS Code extension bundles this server. Any LSP client can run it: setups for Neovim, Vim, Helix, Emacs and JetBrains IDEs are in [`.kick` in other editors](https://kickjs.app/guide/view-editors).

```sh
pnpm add -D @forinda/kickjs-view-language-server
npx -y -p @forinda/kickjs-view-language-server kick-view-ls --stdio
```

`kick-view-ls` is the command, not a package name. Without `-p`, `npx` finds it only when it's installed in the project the editor starts it in; otherwise `npx` looks for a package called `kick-view-ls` and fails with a 404.

Initialization options, relative to the workspace folder:

| option          | default                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `viewsDir`      | `src/views`                                                                                      |
| `componentsDir` | `components`                                                                                     |
| `pipesFile`     | `<viewsDir>/pipes.ts`                                                                            |
| `layout`        | none — the same as `createViews({ layout })`: one name, or folder prefix → layout                |
| `baseLayout`    | none — the same as `createViews({ baseLayout })`                                                 |
| `trusted`       | `false` — only `true` imports the project's `@forinda/kickjs-view` (its code runs in the server) |

Any file ending in `.kick` is a template, whatever `languageId` the editor sends. The custom request `kick/templateNames` returns every template name except components.

See the [views guide](https://kickjs.app/guide/views#editor-support).
