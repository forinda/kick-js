# Components

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

```kick
{{-- src/views/components/user-card.kick --}}
@input user
@input compact = false
<div class="card">
  <strong>{{ user.name }}</strong>
  @if (!compact) {
    <p>{{ user.email }}</p>
  }
  <slot>No details</slot>
  <footer><slot name="footer" /></footer>
</div>

{{-- in a page --}}
@for (u of users; track u.id) {
  <user-card [user]="u" compact class="mb-2">
    Joined {{ u.joined | date:'mediumDate' }}
    @slot('footer') {
      <a href="/users/{{ u.id }}">Open</a>
    }
  </user-card>
}
```

- A tag with a hyphen that matches `src/views/components/<path>.kick` is a component. Folders join with `-`, so `components/forms/text-field.kick` is `<forms-text-field>`. The component's content replaces the tag.
- `@input name` is required; `@input name = value` has a default.
  - `[name]="expr"` passes an expression, `name="text"` a string, and a bare `name` `true`.
  - `compact="false"` passes the string `"false"`, which is truthy, so write `[compact]="false"`.
  - Kebab-case (`user-id="1"`) binds `userId`.
  - A missing required input fails the check.
- Every other attribute goes to the component's single root element. That covers `class`, `id`, `hx-*`, `x-*`, `type`, `[disabled]="…"` and anything else. Classes and styles merge with the root's own; any other attribute replaces the root's attribute of the same name.
  - Each one is checked as if written on that element, so `<ui-link href="{{ url }}">` gets the URL check of the `<a>` it lands on.
  - A name close to an input warns: `compcat` asks whether you meant `compact`.
  - When the root is itself a component (a wrapper such as `primary-button` around `<ui-button>`), the attributes pass on: one the inner component declares becomes its input, and the rest go to its root.
  - Some attributes decide how their element is checked, so the component must declare them as inputs: `type`, `name`, `value`, `checked` and `validate` on an `<input>`, `<select>`, `<textarea>` or `<option>` root (they control form refill), and `http-equiv` and `content` on a `<meta>` root.
  - A component whose root isn't a single element (several roots, a block such as `@if`, a `<slot>`) can't take extra attributes: the check names them. A `<component>` root takes only `class`, `id`, `style`, `role`, `aria-*` and `data-*`, which no check depends on; its element is only chosen at render time.
  - `type` on a `<script>` root is refused too: it decides how `{{ }}` inside the script is checked.
- A component sees only its inputs. Content passed between its tags uses the page's data.
- Components can include themselves (trees), up to 64 levels deep.

## Slots that receive data {#scoped-slots}

A component can hand values to the content its caller puts in a slot: a list that leaves each row's markup to the page, say.

```kick
{{-- src/views/components/user-list.kick --}}
@input users
<ul>
  @for (u of users; track u.id) {
    <li><slot name="row" [user]="u">{{ user.name }}</slot></li>
  }
</ul>
```

```kick
<user-list [users]="team">
  @slot('row'; let user) {
    <a href="/users/{{ user.id }}">{{ user.name }}</a>
  }
</user-list>
```

- A `<slot>` takes only `name="…"`, which picks the slot, and `[value]="expr"` bindings, which offer values (`[name]="…"` offers one called `name`). Any other attribute is an error: a template that used to put `class` on a `<slot>`, where it was ignored, should move it to a real element.
- `[name]="expr"` on a `<slot>` offers a value. The default slot offers values the same way (`<slot [item]="x" />`) and is filled with `@slot(default; let item) { … }`.
- `let user` takes an offered value, and `let u = user` renames it. Taking a name the slot doesn't offer fails the check, listing what it offers. Content written between the tags without `@slot` receives nothing.
- The slot's fallback content can read the values it offers.
- Every `<slot>` with one name must offer the same names.
- A layout's slots can offer values to a page's `@slot` the same way.

## Dynamic components {#dynamic-components}

To pick a component from data, such as a dashboard widget's type, list the ones it may be:

```kick
<component [is]="widget.type" of="chart-bar chart-line stat-card" [data]="widget" />
```

- `of` names the candidate tags, and the check covers every one of them: each must exist, and each one's required inputs must be given. An attribute that one candidate declares as an input goes to that candidate's root on the others.
- At render time, `null` or `undefined` renders nothing. Any value outside the list fails the render, listing the candidates, so data can't reach a component you didn't list.
- Slot content works as for any component. A fill only some candidates have renders for those, and a value only some offer is `undefined` for the rest.

::::
