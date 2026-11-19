# Layouts and Stacks

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

```kick
{{-- src/views/layouts/main.kick --}}
<!doctype html>
<html>
  <head>
    <slot name="head"><title>My app</title></slot>
  </head>
  <body>
    <slot />
  </body>
</html>
```

```kick
{{-- src/views/about.kick --}}
@layout('layouts/main')
@slot('head') {
  <title>About</title>
}
<h1>About us</h1>
```

A page renders into its layout's `<slot />`. `@slot('name') { … }` fills a named slot, replacing the slot's fallback content. Layouts can declare their own `@layout` and nest.

## Dashboards: layouts by folder, and a base layout

```ts
createViews({
  ...kickViews,
  layout: {
    admin: 'layouts/admin', // admin/** pages
    'admin/reports': 'layouts/reports', // the longest prefix wins
    seller: 'layouts/seller',
    '': 'layouts/page', // everything else
  },
  baseLayout: 'layouts/base',
})
```

- **`layout` mapping:** a page that declares no `@layout` gets the layout of the longest folder prefix matching its name. Each dashboard keeps its own layout without every page repeating it.
- **`baseLayout`:** the HTML shell, with CSS, `@assets` and SEO tags, wrapped around every page's outermost layout, so the dashboard and page layouts don't each have to include it. A page fills the base's slots (`@slot('head') { … }`) through whatever layouts sit in between.
- **Precedence:**
  1. `ctx.render(name, data, { layout: false })` renders no layout at all, for htmx and other partial responses.
  2. `{ layout: 'layouts/print' }` picks one layout for this render.
  3. `@layout(none)` in the page skips layouts, base included.
  4. `@layout('…')` in the page.
  5. The mapping.
  6. The base alone.

## Stacks

A page or component often needs something in the `<head>`, such as a stylesheet, a `<meta>` tag or a preload, or a script at the end of `<body>`. A layout marks the place with `<stack>`, and any template adds to it with `@push`:

```kick
{{-- src/views/layouts/main.kick --}}
<!doctype html>
<html>
  <head>
    <title>My app</title>
    <stack name="head" />
  </head>
  <body>
    <slot />
    <stack name="scripts" />
  </body>
</html>
```

```kick
{{-- src/views/components/date-picker.kick --}}
@input name
@push('head') {
  <link rel="stylesheet" href="/css/date-picker.css">
}
<input type="date" name="{{ name }}">
```

- **Where.** `<stack name="…" />` goes in a page or layout, the base layout included. `@push('…') { … }` works anywhere: pages, layouts, components, inside `@if` and `@for`. Names are letters, digits, `-` and `_`.
- **What counts.** Only pushes that render: one inside a false `@if` adds nothing, one inside a loop adds each time round.
- **Once each.** Identical content pushed to the same stack is output once, so a component used fifty times links its stylesheet once. Different content is all kept.
- **Order.** Content comes out in the order it renders. The outermost layout renders first and the page appears where it reaches `<slot />`, so a layout's push above its `<slot />` comes before the page's, and one below it comes after.
- **Nowhere to go.** Content pushed to a name no rendered template has is dropped, with a warning in development. A partial render (`layout: false`, a [fragment](./htmx.md#fragments)) has no layout, so its pushes are dropped silently.
- **One per name.** When two `<stack>`s share a name, the first gets the content; the check warns when both are in one file.
- **`<stack>` is reserved,** like `<slot>`: it isn't output as an element.

::::
