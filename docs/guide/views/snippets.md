# Snippets

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

A piece of markup used several times in one template, with parameters:

```kick
@snippet badge(label, tone = 'info') {
  <span class="badge" [class.warn]="tone == 'warn'">{{ label }}</span>
}

<p>@render badge(user.role) @render badge('Overdue', 'warn')</p>
```

- `@snippet` goes at the top level of a page, layout or component. It can come after the `@render`s that use it, and its definition prints nothing.
- Arguments are given by position. A parameter with a literal default (`tone = 'info'`) can be left out; too few or too many arguments fail the check.
- A snippet sees its parameters and what the template sees at its top level: page data in a page, inputs in a component. It doesn't see loop variables from where it's rendered, or top-level `@let`s: pass those as parameters. So it renders the same everywhere, including in a [fragment](./htmx.md#fragments).
- A snippet can render itself, up to 64 levels deep. Markup shared between files is a [component](./components.md).

::::
