# Partials, htmx and Fragments

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

```ts
@Get('/users/rows')
async rows(ctx: RequestContext) {
  await ctx.render('users/rows', { users }, { layout: false })
}
```

`ctx.render` also takes `status` and `headers`: `{ status: 422, headers: { 'HX-Retarget': '#form' } }`.

## Fragments {#fragments}

An htmx swap usually needs one piece of a page. Mark it with `@fragment`, and render just that piece with the same template, instead of a separate partial file:

```kick
{{-- src/views/users/index.kick --}}
@layout('layouts/main')
<h1>Users @fragment('count') {<span id="count" hx-swap-oob="true">{{ users.length }}</span>}</h1>
<table>
  <tbody id="rows">
    @fragment('rows') {
      @for (user of users; track user.id) {
        @fragment('row') {
          <tr id="user-{{ user.id }}"><td>{{ user.name }}</td></tr>
        }
      }
    }
  </tbody>
</table>
```

```ts
await ctx.render('users/index', { users }) // the whole page
await ctx.render('users/index', { users }, { fragment: 'rows' }) // just the rows
await ctx.render('users/index', { user }, { fragment: 'row' }) // one row, after an edit
await ctx.render('users/index', { users }, { fragment: ['rows', 'count'] }) // out-of-band swap
```

- **In the full page** the wrapper changes nothing: the block renders where it is.
- **On its own** it renders without any layout. A list renders each fragment in the order given, for htmx's out-of-band swaps: the extra fragments carry their own `id` and `hx-swap-oob`, like `count` above, so htmx puts each where it belongs.
- **Names from around it.** A fragment inside `@for`, `@if (…; as x)` or after `@let` reads those names from the data you pass: the `row` above needs `user`. Leaving one out fails the render naming it. `share()` data doesn't count, so a shared `user` can't silently fill a row's. An enclosing loop's `$index` and friends can't be read directly: alias them (`let i = $index`) and pass `i`.
- **Names are unique** in a template, made of letters, digits, `-` and `_`. Asking for one the template doesn't have fails the render, listing the ones it has.
- **Anywhere but components.** Pages and layouts can have fragments; components can't.
- **Scripts still ship.** A component with a [script](./client-scripts.md) inside a fragment still gets its `<script>` tag; [stack](./layouts.md#stacks) pushes are dropped.
- **Edge builds.** Templates with fragments compile to a newer bundle format: rebuild with the matching `@forinda/kickjs-vite`.

::::
