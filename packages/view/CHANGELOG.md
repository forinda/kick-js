# @forinda/kickjs-view

## 0.1.1

### Patch Changes

- [#1017](https://github.com/forinda/kick-js/pull/1017) [`5c6f2b8`](https://github.com/forinda/kick-js/commit/5c6f2b8c09bdb988a7ccc1247fe78ab6a845d1d5) Thanks [@forinda](https://github.com/forinda)! - Template edits show up on the next request under `kick dev` again when you pass your own `createViews({ ...kickViews })` to `KickView({ views })`, the setup the guide shows. `createViews` now turns on its source re-check by default when `bundle` is `null`, which is what `virtual:kick-views` hands over in dev.

- [#1021](https://github.com/forinda/kick-js/pull/1021) [`e0fe1af`](https://github.com/forinda/kick-js/commit/e0fe1afb9c8943198dc8b73c9e1574d47c9ff32a) Thanks [@forinda](https://github.com/forinda)! - Formatter: `{{ title|titlecase }}` becomes `{{ title | titlecase }}`, in interpolations and block headers (`@for (x of obj | entries)`); `||` and quoted text are left alone. A closing tag or `}` that follows content on a line, while its opener is on an earlier line, moves to its own line, so `<title>t</title></slot>` no longer leaves `</slot>` trailing. `kick fmt:views` and Format Document in the editor both use it.

- [#1020](https://github.com/forinda/kick-js/pull/1020) [`1d66550`](https://github.com/forinda/kick-js/commit/1d66550111e6e28e19bb2951e73fbceaca2b9c4c) Thanks [@forinda](https://github.com/forinda)! - README: shows how to add `viewCliPlugin` to `kick.config.ts` for `kick fmt:views` and `kick check:views`.

## 0.1.0

### Minor Changes

- [#1011](https://github.com/forinda/kick-js/pull/1011) [`5bffa66`](https://github.com/forinda/kick-js/commit/5bffa66befe08d3e2385e5dad989c0b85fad6434) Thanks [@forinda](https://github.com/forinda)! - New, experimental: `.kick` views — KickJS's own template language for server-rendered pages:
  
  - `{{ value | pipe }}` interpolation, escaped for where it lands: text, attributes, URL attributes (unsafe schemes become `#`) and JSON scripts.
  - `@if` / `@else`, `@for` / `@empty`, `@switch`, `@let`, `@verbatim`.
  - Bindings: `[attr]`, `[class.x]`, `[style.x]`.
  - Layouts with named slots, layouts mapped by folder (one per dashboard), and a `baseLayout` around every page.
  - Components with declared `@input`s and slots.
  - Built-in pipes (dates, numbers and currency in a given locale and time zone, `json`, `url`, `raw`), plus your own from `src/views/pipes.ts`.
  - `createViews().render()` outside a request, for emails and tests.
  - `KickView` makes `ctx.render()` work on Express, Fastify, h3 and the web entry; `viewsMiddleware` does the same for the edge.
  
  `kick fmt:views` and `kick check:views` (through `viewCliPlugin` from `@forinda/kickjs-view/cli`) format and check templates.
  
  Templates can't call functions or reach prototypes, and refuse interpolation where escaping can't make it safe. The format is experimental while the package is 0.x.

### Patch Changes

- [#1015](https://github.com/forinda/kick-js/pull/1015) [`996c968`](https://github.com/forinda/kick-js/commit/996c968b79b79b961584660cee4f6cef1e8ddedd) Thanks [@forinda](https://github.com/forinda)! - Export `format` from the Node entry, so editors format `.kick` files with the same engine as `kick fmt:views`.
