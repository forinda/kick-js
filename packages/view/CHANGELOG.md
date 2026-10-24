# @forinda/kickjs-view

## 0.4.1

### Patch Changes

- [#1064](https://github.com/forinda/kick-js/pull/1064) [`d87935f`](https://github.com/forinda/kick-js/commit/d87935fab55a0e2adf53fdb4807bc5bd3dd2ae10) Thanks [@forinda](https://github.com/forinda)! - Views fixes:
  
  - A built `validators.ts` that imports CSS gets its stylesheet linked on pages with a `validate` field.
  - From source, a `validators.js` is served as written instead of going through the TypeScript stripper, and an async `stripTypes` option is awaited before the validators register themselves.
  - `vite build --watch` rebuilds when `validators.ts` is added, and when a file a client script or `validators.ts` imports changes.
  - `kick add views` skips the `kick.config.ts` hint when `viewCliPlugin` is already there, and its `home` page reads "Hello from KickJS" when rendered with no data. The views forms skill covers `validators.ts`.

## 0.4.0

### Minor Changes

- [#1052](https://github.com/forinda/kick-js/pull/1052) [`d2c3568`](https://github.com/forinda/kick-js/commit/d2c356828abb268dc520e57c16e9e8957a9ecfe0) Thanks [@forinda](https://github.com/forinda)! - Your own browser validators: each export of `src/views/validators.ts` is a validator usable in `validate="…"` beside the built-ins (`validate="required | phone"`, `validate="sameAs:'password'"`). A validator gets the value, the template's arguments and the form, and returns a message when the value fails. Names are checked like pipes, and an export named like a built-in is an error. The file ships as `kick-validators.<hash>.js` on pages with a `validate` field. New: `validatorsFile` option, `readValidatorExports`, `BUILTIN_VALIDATORS`, `kick check:views --validators`.

- [#1054](https://github.com/forinda/kick-js/pull/1054) [`772b563`](https://github.com/forinda/kick-js/commit/772b56357a95f1044732ba871e4212893fe258ae) Thanks [@forinda](https://github.com/forinda)! - A built-in `kvRoute` pipe links templates to the app's routes by name: `href="{{ 'UsersController.show' | kvRoute:user.id }}"`. The arguments fill the route's params in path order, through the request's `ctx.urlFor`, so the API prefix and version are included. `kvQuery` adds query parameters as key/value pairs: `{{ 'UsersController.list' | kvRoute | kvQuery:'page':page }}`, skipping empty values. Outside a request `kvRoute` fails with a message saying to pass URLs as data. The `kv` prefix (KickJS views) keeps `route` free for an app's own pipe.

### Patch Changes

- [#1046](https://github.com/forinda/kick-js/pull/1046) [`f00cbf2`](https://github.com/forinda/kick-js/commit/f00cbf2a91d7fa1702aa310bc841c8c425070fda) Thanks [@forinda](https://github.com/forinda)! - `share`'s `ctx` is typed `ShareContext | undefined` (`req` and `get()`), instead of `unknown`, so `share: (ctx) => ({ user: ctx?.get('user'), csrfToken: csrfToken(ctx) })` type-checks without a cast.

## 0.3.0

### Minor Changes

- [#1042](https://github.com/forinda/kick-js/pull/1042) [`2ab6a74`](https://github.com/forinda/kick-js/commit/2ab6a746dd2df28192280a33027208bcd01a3659) Thanks [@forinda](https://github.com/forinda)! - Client files on disk. A bundle's `client.disk` lists files the build wrote to disk; `createViews({ clientDir })` (from `virtual:kick-views`) points at their folder. The Node entry serves them, bytes and all, with their content type (`views.clientFile(file)`); only listed names are ever read. The edge entry has no reader, so those requests fall through to the platform's static files. `useClientFiles(read)` sets the reader.

- [#1041](https://github.com/forinda/kick-js/pull/1041) [`a90596b`](https://github.com/forinda/kick-js/commit/a90596b3577f1f2a4d8fc34760254ae7a2eaa328) Thanks [@forinda](https://github.com/forinda)! - Client scripts can import. A bundle's `client` map (`entries` by component tag, `files` with entries and shared chunks) is served from `clientScriptPath`, and a page's tag points at the component's entry. Served file names may now be bundler names (`<name>.<hash>.js`, letters, digits, `_` and `-`). The checker no longer refuses imports. Without a bundler (plain Node, no `kick dev`), a script that imports fails at render with `client scripts that import need kick dev or a kick build`; self-contained scripts work as before. The bundle's `client.css` (stylesheets by component tag) is linked in the page's `<head>` when the component renders, and `.css` files are served as `text/css`. Under `kick dev`, scripts aren't type-stripped by the server (Vite does it), and the import check ignores comments and strings.

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
