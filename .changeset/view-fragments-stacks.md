---
'@forinda/kickjs-view': minor
'@forinda/kickjs-view-language-server': minor
'@forinda/kickjs': minor
---

`.kick` views get fragments and stacks.

- **Fragments:** mark a block of a page with `@fragment('rows') { … }`, and render only that block, without layouts, with `ctx.render('users/index', data, { fragment: 'rows' })`, or several at once with `{ fragment: ['rows', 'count'] }` for htmx out-of-band swaps. A fragment inside `@for`, `@if (…; as x)` or after `@let` reads those names from the data the controller passes; a missing one fails the render. `share()` data doesn't count towards them.
- **Stacks:** a layout marks a place with `<stack name="head" />`, and pages, layouts and components add to it with `@push('head') { … }`, from anywhere in the page. Identical content is output once.
- **Editor:** completion for `@fragment`, `@push` and stack names; the formatter handles both blocks.

Compatibility:

- `@fragment(` and `@push(` in template text now start a block; without `(` they stay text.
- `<stack>` is reserved, like `<slot>`.
- Compiled templates use bundle format v2: an edge build made with the previous `@forinda/kickjs-view` is refused at startup until it's rebuilt.
