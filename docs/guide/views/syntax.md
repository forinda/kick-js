# Template Syntax

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

Templates live in `src/views/**/*.kick`. `ctx.render('users/show')` renders `src/views/users/show.kick`. A name is folders and a file name made of letters, digits, `-` and `_`. Any other name, including `..` or an absolute path, is refused, even when it comes from a request.

## Interpolation

`{{ expression }}` prints a value, escaped for where it lands:

| value                   | prints                                                        |
| ----------------------- | ------------------------------------------------------------- |
| string                  | escaped                                                       |
| number, bigint, boolean | as text (`true`)                                              |
| `null`, `undefined`     | nothing                                                       |
| `Date`                  | ISO string — use `\| date` for display                        |
| array, object, Promise  | nothing, with a warning in dev (an error with `strict: true`) |

`{{ html | raw }}` prints trusted HTML unescaped. `raw` must be the whole expression's last pipe, and it isn't allowed in attributes, `<title>` or `<textarea>`. Inside `<style>` it's allowed only as the element's whole content: `<style>{{ css | raw }}</style>`.

## Expressions

Templates read data; controllers compute it. An expression can use:

- property paths: `user.name`, `user?.address?.city`, `items[0]`, `row[key]`
- literals: `'text'`, `"text"`, `42`, `-1.5`, `true`, `false`, `null`
- `!`, `-`, `+`, `-`, `<`, `>`, `<=`, `>=`, `==`, `!=`, `&&`, `||`, `??`, `a ? b : c`
- pipes: `price | currency:'KES':'1.2-2'`

Calls, assignment, `new`, `* / %`, arrow functions and object or array literals are compile errors. Methods and other functions read as `undefined`, and `__proto__` / `constructor` / `prototype` are never reachable.

`==` and `!=` are strict (`1 == '1'` is false). Truthiness follows JavaScript, so an empty array is truthy: write `@if (items.length)`, or use `@for … @empty`.

Pipes bind loosest: `a ? b : c | upper` pipes the whole conditional. A conditional pipe argument needs parentheses.

| precedence, low to high |
| ----------------------- |
| `\|`                    |
| `? :`                   |
| `??`                    |
| `\|\|`                  |
| `&&`                    |
| `==` `!=` `===` `!==`   |
| `<` `>` `<=` `>=`       |
| `+` `-`                 |
| `!` `-` (unary)         |
| `.` `?.` `[]`           |

A name the data doesn't have prints nothing and logs a warning in dev. With `strict: true` it's an error, except on the left of `??` or before `?.`: `{{ showPositions ?? true }}` and `{{ fees?.paid }}` read a missing name as `undefined`, so an optional field needs no placeholder in the data. In a chain, `{{ a ?? b ?? 'none' }}`, only the last fallback must exist.

## Control flow

```kick
@if (user.isAdmin) {
  …
} @else if (user; as u) {
  Hi {{ u.name }}
} @else {
  …
}

@for (item of items; track item.id; let i = $index, last = $last) {
  …
} @empty {
  …
}

@switch (order.status) {
  @case ('paid') {
    Paid
  }
  @case ('due') {
    Due
  }
  @default {
    Unknown
  }
}

@let total = order.subtotal + order.shipping;
```

- `@for` loops over arrays, `Set`s, strings, and `Map`s (`@for ([key, value] of map)`). A plain object needs `| entries`. `null` shows `@empty`.
- Loop variables: `$index`, `$first`, `$last`, `$even`, `$odd`, `$count`.
- `track` is accepted and ignored.
- A line holding only `@if (…) {` or `}` leaves no blank line in the output.

## Comments and literal text

- `{{-- not in the output --}}` is a template comment. HTML comments are kept, and can't contain `{{ }}`.
- `@` starts a block only before a keyword in text, so `hi@example.com` and Alpine's `@click="…"` stay as written.
- A literal `}` inside a block is `&#125;`.
- `@verbatim { … }` outputs its content untouched, for pages that ship Vue, Alpine or Handlebars templates to the browser.

::::
