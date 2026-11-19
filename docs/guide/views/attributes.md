# Attributes and Escaping

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

## Attributes and bindings

```kick
<a href="/users/{{ user.id }}">profile</a>
<button [disabled]="!canEdit">Save</button>
<li class="item" [class.active]="item.id == current">…</li>
<div [style.width.px]="progress">…</div>
```

- `[attr]="expr"` drops the attribute for `null`, `undefined` or `false`, and writes it bare for `true`.
- `[class.name]` adds a class when the value is truthy.
- `[style.prop]` (`.px` and other units allowed) sets one property. A value that could leave its property (`;`, `url(`, quotes) is dropped.
- `class` and `style` themselves can't be interpolated; use the bindings.

## Escaping and what's refused

| where `{{ }}` lands                                                                                                                                                | what happens                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| text, `<title>`, `<textarea>`                                                                                                                                      | HTML-escaped                                                                                     |
| a quoted attribute                                                                                                                                                 | HTML-escaped                                                                                     |
| a URL attribute (`href`, `src`, `action`, `srcset`, …)                                                                                                             | also scheme-checked: anything but `http`, `https`, `mailto`, `tel` or a relative URL becomes `#` |
| `<script type="application/json">{{ data \| json }}</script>`                                                                                                      | JSON escaped so it can't close the script                                                        |
| `<style>{{ css \| raw }}</style>`, as the whole content (CSS inlined for a PDF or an email)                                                                        | printed as is; the render fails if it contains `</style`                                         |
| any other `<script>` / `<style>` content, `on*` attributes, `style`, `srcdoc`, a refresh `<meta>`, an HTML comment, an unquoted attribute, a tag or attribute name | compile error                                                                                    |

`<script src="{{ cdn }}" nonce="{{ cspNonce }}">` is fine: only a script's content is refused.

::::
