# View Roots

An app's templates live in `src/views`. A **view root** is another folder of templates, with a name: a module that keeps its views beside its code, or a package that ships views for any app that installs it. A root's templates are named `root::path`:

```ts
ctx.render('billing::invoices/show', { invoice })
```

## Declaring roots

List them once, in `kick.config.ts`. The runtime, the Vite build, `kick check:views`, `kick fmt:views`, typegen and the editor all read this list:

```ts
// kick.config.ts
export default defineConfig({
  views: {
    dir: 'src/views', // the app's own templates (the default)
    roots: {
      billing: './src/modules/billing/views', // a folder
      ui: '@acme/kick-ui', // an installed package
    },
  },
})
```

- A value starting with `.` or `/` is a folder, relative to the directory holding `kick.config.ts`.
- Any other value is an installed package, found the way Node finds it. If no such package is installed, it's a folder.
- Root names are lowercase letters, digits and `-`, starting with a letter.
- A bad name, a missing folder, or a package that doesn't say where its views are stops the build and the commands with a message naming the root.

The Vite plugin hands the roots to `createViews` through `virtual:kick-views`, so `createViews({ ...kickViews })` needs nothing more. Without Vite (a plain Node script, a test), pass them yourself, as absolute folders: `createViews({ roots: { billing: '/app/src/modules/billing/views' } })`.

## Names and what they find

A reference in a root's template looks in that root first, then in the app's. In `billing::invoices/show`:

```kick
@layout('layouts/main')
<h1>Invoice {{ invoice.number }}</h1>
```

`layouts/main` is `billing::layouts/main` when the billing folder has one, otherwise the app's `layouts/main`. A qualified name, such as `@layout('ui::layouts/card')`, goes exactly there. The app's own templates reach a root only by its prefix.

A root page without `@layout` gets the app's layout, as any page does (the `layout` and `baseLayout` options).

Two roots can both have an `index`: `a::index` and `b::index` never meet.

## Components

Custom element names are global in the browser, so a root's component tag starts with the root's name. `components/button.kick` in the `ui` root is `<ui-button>` everywhere, in the app's templates and in the root's own:

```kick
<ui-button>Save</ui-button>
```

Its `<script client>` defines `ui-button`. If an app component would get the same tag (`components/ui/button.kick`), `kick check:views` reports both files.

A root's templates use the app's pipes (`src/views/pipes.ts`) and validators (`validators.ts`).

## Shipping views in a package

A package says where its views are in its `package.json`:

```json
{
  "name": "@acme/kick-ui",
  "kick": { "views": "views" },
  "files": ["dist", "views"]
}
```

- Ship the `.kick` source. The app checks, types and bundles a package's templates like its own, against its pipes and layouts.
- Ship the types the templates import (`@import type`, `import('…')`), as `.ts` or matching `.d.ts` files. Typed `ctx.render` for the package's pages needs them.

## What the tools do with roots

- **`kick check:views`** checks every root. Errors name the real file (`src/modules/billing/views/invoices/show.kick`).
- **`kick fmt:views`** formats the app's folder and every root you can edit, but not an installed package's: anything whose real path is inside `node_modules`. A workspace package linked into `node_modules` is yours to edit, so it is formatted.
- **Typegen** types root pages by full name: `ctx.render('billing::invoices/show', data)` is checked like any page.
- **The Vite build** bundles every root. In `kick dev`, edited templates are picked up on the next render, and editable roots outside the project are watched for `<script client>` changes.
- **The editor** reads the roots from `kick.config.ts` in a trusted workspace, since loading it runs the project's code. Otherwise, set `kickjs.views.roots` in the VS Code settings. Go to definition, hover and diagnostics work across roots.
