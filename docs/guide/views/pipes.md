# Pipes

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

| pipe                                  | example                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `uppercase`, `lowercase`, `titlecase` | `{{ name \| titlecase }}`                                                                                                                    |
| `date:format:timeZone?`               | `{{ at \| date:'short' }}` — `short`, `medium`, `long`, `full`, `shortDate`, `mediumDate`, `longDate`, `fullDate`, `shortTime`, `mediumTime` |
| `number:digits`                       | `{{ n \| number:'1.0-2' }}` — `minInt.minFrac-maxFrac`                                                                                       |
| `currency:code:digits?`               | `{{ price \| currency:'KES' }}`                                                                                                              |
| `percent:digits?`                     | `{{ ratio \| percent }}`                                                                                                                     |
| `slice:start:end`                     | `{{ items \| slice:0:3 }}`                                                                                                                   |
| `join:separator?`                     | `{{ names \| join:', ' }}` — a list as text; `', '` by default                                                                               |
| `compact`                             | `{{ addressLines \| compact \| join:' · ' }}` — drops `null`, `undefined`, `false` and `''`, keeps `0`                                       |
| `keys`, `entries`                     | `@for ([k, v] of obj \| entries) { … }`                                                                                                      |
| `json`                                | `{{ data \| json }}`                                                                                                                         |
| `url`                                 | `href="/search?q={{ term \| url }}"`                                                                                                         |
| `kvRoute:param…`                      | `href="{{ 'UsersController.show' \| kvRoute:user.id }}"` — see [Links to routes](#links-to-routes)                                           |
| `kvQuery:key:value…`                  | `href="{{ 'UsersController.list' \| kvRoute \| kvQuery:'page':page }}"` — query parameters, see [Links to routes](#links-to-routes)          |
| `raw`                                 | `{{ html \| raw }}`                                                                                                                          |

More pipes, for text, lists and formatting:

| pipe                 | example                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `truncate:n:suffix?` | `{{ post.body \| truncate:120 }}` — at most `n` characters, then `…` (or the suffix you give)     |
| `default:value`      | `{{ user.bio \| default:'No bio yet' }}` — for `null`, `undefined` and `''`; keeps `0`, `false`   |
| `nl2br`              | `{{ comment \| nl2br }}` — escapes the text, then turns line breaks into `<br>`                   |
| `striptags`          | `{{ html \| striptags \| truncate:80 }}` — drops tags; the rest is still escaped                  |
| `first`, `last`      | `{{ items \| first }}` — of a list, a Set or a string                                             |
| `length`             | `{{ items \| length }}` — of a list, string, Set, Map or object (its keys); `0` for nothing       |
| `sort:key?`          | `@for (u of users \| sort:'name') { … }` — a sorted copy; text by the render's locale             |
| `groupBy:key`        | `@for ([status, list] of orders \| groupBy:'status') { … }` — `[group, items]` pairs, in order    |
| `sum:key?`           | `{{ lines \| sum:'total' \| currency:'KES' }}`                                                    |
| `plural:one:other`   | `{{ count \| plural:'item':'items' }}` — `1 item`, `1,024 items`                                  |
| `ago`                | `{{ post.at \| ago }}` — `3 hours ago`, `in 2 days`                                               |
| `filesize`           | `{{ file.size \| filesize }}` — `1.5 kB`, `2 MB`                                                  |
| `t:name:value…`      | `{{ 'cart.items' \| t:'count':n }}` — a translated message, see [Translations](./translations.md) |

Dates and numbers use `locale` (default `en-US`) and `timeZone` (default `UTC`, never the server's zone). Set them in `createViews`, or per call: `ctx.render(name, data, { locale: 'sw-KE', timeZone: 'Africa/Nairobi' })` (for a per-request choice, pass the user's here). `share` adds data, not settings, so it doesn't change them.

## Links to routes

`kvRoute` turns a route's name into its URL, the way [`ctx.urlFor()`](../controllers.md#linking-to-routes) does in a controller, so a moved route can't leave a link pointing at the old path:

```kick
<a href="{{ 'UsersController.show' | kvRoute:user.id }}">{{ user.name }}</a>
<form method="post" action="{{ 'PostsController.update' | kvRoute:user.id:post.slug }}"></form>
<a href="{{ 'UsersController.list' | kvRoute | kvQuery:'page':2 }}">All users</a>
```

- The name is `'Controller.method'`; the API prefix and version are included.
- The arguments fill the route's `:params` in the order its path has them (`/users/:id/posts/:slug` takes `user.id`, then `post.slug`), encoded. A wrong count, or a name no route has, fails the render with the route's own message.
- Order is what matters, not names: two arguments swapped give a wrong URL, not an error. Keep them in the path's order.
- An argument is any expression: data, a literal, `a ?? b`. A conditional needs parentheses, as for any pipe argument: `kvRoute:org.slug:(draft ? 'drafts' : 'posts')`.
- Query parameters: chain `kvQuery` with key/value pairs. Values are encoded; `null`, `undefined` and `''` leave their key out, so optional filters pass straight through; an array repeats the key. It adds to a query the URL already has and keeps a `#fragment` last, so it works on any URL, not only `kvRoute`'s:

  ```kick
  <a href="{{ 'UsersController.list' | kvRoute | kvQuery:'page':page + 1:'role':filters.role }}">Next</a>
  ```

- It needs the request: inside `ctx.render`. For a page rendered elsewhere (an email, a job), build the URLs with [`ROUTE_URLS`](../controllers.md#linking-to-routes) and pass them in as data.

## Your own pipes

Export them from `src/views/pipes.ts`:

```ts
import { safeHtml, withEnv } from '@forinda/kickjs-view'

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')

export function stars(n: number) {
  return safeHtml('★'.repeat(n)) // trusted HTML, printed as is in text
}

export const ago = withEnv(
  ({ locale }) =>
    (date: Date) =>
      new Intl.RelativeTimeFormat(locale).format(
        Math.round((+date - Date.now()) / 86_400_000),
        'day',
      ),
)
```

Some rules, because the build and the editor read this file without running it:

- Export each pipe by name: `export const`, `export function`, or `export { a, b as c }`. `export *`, default exports and re-exports aren't allowed.
- A pipe can't reuse the name of a pipe in the first table. The pipes in the second table (and `t`) can be replaced: export your own `ago` or `truncate` and yours is used. `default` is a keyword, so name yours something else and export it as `export { fallback as default }`.
- Pipes are synchronous. Load data in the controller.

::::
