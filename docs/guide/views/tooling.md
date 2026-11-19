# Formatting, Checking and Editors

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

## Formatting and checking

Add the plugin to `kick.config.ts`:

```ts
import { viewCliPlugin } from '@forinda/kickjs-view/cli'
export default defineConfig({ plugins: [viewCliPlugin] })
```

- `kick fmt:views` formats every template: `{{ x | pipe }}` and `@if (x) {` spacing, indentation by nesting, and a closing tag or `}` on its own line when its opener is on an earlier one. `<pre>`, `<textarea>`, `<script>`, `<style>`, `@verbatim` and comments are left exactly as written. A file is only rewritten if the result means the same template; otherwise it's left alone with a warning.
- `kick fmt:views --check` lists the files that would change and exits 1, which suits CI.
- `kick check:views` reports every error with its file, line and column, the same checks the build runs: syntax, unknown pipes, component inputs, slots, layouts and unsafe interpolation.
- `kick typegen` writes the types that check `ctx.render`: see [Typed render data](./typed-render-data.md).

When your views aren't in `src/views`, use the factory, which also tells the typegen where to look:

```ts
import { kickViewsCli } from '@forinda/kickjs-view/cli'
export default defineConfig({ plugins: [kickViewsCli({ dir: 'app/views', componentsDir: 'ui' })] })
```

## Editor support

The KickJS VS Code extension understands `.kick` files:

- highlighting for `{{ }}`, `@if` / `@for` / `@switch`, bindings and comments, on top of HTML;
- errors as you type, from the same checks as `kick check:views`, including in unsaved files;
- snippets for whole blocks — type `kick-` for `kick-page`, `kick-layout`, `kick-component`, `kick-component-script`, `kick-for`, `kick-form`, `kick-field` and `kick-flash`;
- completion for `@` keywords, pipes after `|`, components and their inputs, layout, slot and stack names, snippet names after `@render`, the values a slot passes after `@slot('…'; let`, component tags in `of="…"`, and the names in scope inside `{{ }}`;
- HTML, CSS and Emmet completion inside templates;
- hover on a pipe or a component to see its parameters or inputs;
- go to definition on a component tag, `@layout('…')` or a pipe;
- find references to a component, layout or pipe across templates;
- rename a pipe (its uses and `pipes.ts`), a component (its tags and file) or a layout (its `@layout('…')` uses and file), and renaming a template file in the explorer updates its uses, including the `ctx.render('…')` calls that name it;
- Format Document, with the same output as `kick fmt:views`;
- template names inside `ctx.render('…')` in your controllers.

In a trusted workspace the editor uses your project's installed `@forinda/kickjs-view`, so it agrees with your build. If the project has none, it uses its bundled copy and says so once in the output panel.

Settings (relative to the workspace folder):

| setting                     | default          |                                                                   |
| --------------------------- | ---------------- | ----------------------------------------------------------------- |
| `kickjs.views.dir`          | `src/views`      |
| `kickjs.views.components`   | `components`     |
| `kickjs.views.pipes`        | `<dir>/pipes.ts` |
| `kickjs.views.layout`       | none             | as `createViews({ layout })`: one name, or folder prefix → layout |
| `kickjs.views.baseLayout`   | none             | as `createViews({ baseLayout })`                                  |
| `kickjs.views.trace.server` | `off`            |                                                                   |

If your `createViews` maps layouts by folder or sets a `baseLayout`, give the editor the same values in `kickjs.views.layout` and `kickjs.views.baseLayout`. The editor doesn't read your `createViews` call, so without them it can't tell which layout a page without `@layout` renders in, and warns that its `@slot` blocks have no layout to fill.

Other editors (Neovim, Vim, Helix, Emacs, JetBrains IDEs) can run the same language server directly: see [`.kick` in other editors](../view-editors.md).

::::
