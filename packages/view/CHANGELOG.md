# @forinda/kickjs-view

## 0.2.0

### Minor Changes

- [#1038](https://github.com/forinda/kick-js/pull/1038) [`e5bfa90`](https://github.com/forinda/kick-js/commit/e5bfa90f2600c621f86d9e8386f6d6f1046433a6) Thanks [@forinda](https://github.com/forinda)! - Components with a script. A component's top-level `<script client>` holds TypeScript for the browser. A page that renders the component gets one `<script type="module" src="/_kick/c/<tag>.<hash>.js">` for it before `</body>`, with `nonce` from `cspNonce`. A page that renders none gets no JavaScript. `KickView` serves the scripts with long-lived caching. On the web fetch entry, `clientScriptResponse(views, request)` serves them ahead of the router. Types are stripped by `kick build`, or at runtime with Node 22.13+'s stripper, registered by the Node entry only, so edge bundles don't reference `node:module`. Scripts are self-contained for now (no `import`), only in components, at most one each. `createViews` takes `clientScriptPath` and `stripTypes`.

- [#1036](https://github.com/forinda/kick-js/pull/1036) [`4e7b07b`](https://github.com/forinda/kick-js/commit/4e7b07b54147aba8ca04eee2964848885575da24) Thanks [@forinda](https://github.com/forinda)! - Forms: every template, components included, gets `$errors`, `$old` and `$flash` from the request's session, each shown once. A controller's own `$errors` / `$old` in the render data win, for re-rendering a form. `@error('field') { … }` renders a field's error as `$message`. Named inputs, textareas, selects, checkboxes and radios refill from `$old` on their own, unless the template sets their value, and never for passwords, files, hidden fields, a bound `[type]` or secret-looking names. Options and checkboxes match on their written or interpolated `value`. A full page rendered by a GET is remembered in the session so a failed form goes back to it.

- [#1039](https://github.com/forinda/kick-js/pull/1039) [`bc7e084`](https://github.com/forinda/kick-js/commit/bc7e084bad20e1f1fbc103517a8f595e4b8223f6) Thanks [@forinda](https://github.com/forinda)! - Browser validators. `validate="required | minLength:3"` on a named field gives instant feedback before a form is sent. The available validators are `required`, `email`, `url`, `minLength`, `maxLength`, `min`, `max`, `pattern` and `in`, and the check refuses unknown or malformed ones. Messages go into the field's `@error` spot, which also gets `setCustomValidity`. Submitting with an invalid field is stopped and focuses the first one. A page with a `validate` field ships one small validator script (`/_kick/c/kick-validate.<hash>.js`); other pages ship none. **`@error` output changes.** `@error('field')` now always renders a `<span data-kick-error="field" aria-live="polite">` spot, hidden while there's no error, so its output goes from the bare body to the body inside that span. Keep `@error` bodies inline (text, `<b>`, `<small>`): a `<p>`, `<li>` or `<tr>` body was valid before and isn't inside a `<span>`, and a table moves it out. Move block markup outside the `@error`, or change it to inline elements.

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
