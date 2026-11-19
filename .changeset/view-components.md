---
'@forinda/kickjs-view': minor
'@forinda/kickjs-view-language-server': minor
---

`.kick` components get four features from other template engines.

- **Attribute passthrough:** every attribute on a component tag that isn't a declared `@input` goes to the component's root element, checked as if written there, so `<ui-button type="submit" hx-post="/save">` works. Through a wrapper component, attributes reach the inner component as inputs, or its root. A name close to an input warns.
- **Slots that receive data:** `<slot name="row" [user]="u" />` in a component, `@slot('row'; let user) { … }` in the caller.
- **Snippets:** `@snippet badge(label, tone = 'info') { … }` and `@render badge(x)`, within one template.
- **Dynamic components:** `<component [is]="w.type" of="chart-bar chart-line" />` renders one of the listed components, every one of them checked.

The editor completes snippet names, a slot's values and `of` tags; the formatter handles the new headers.

Compatibility:

- An attribute that isn't an input used to fail the check ("unknown input"); it now goes to the root element. `type`, `name`, `value`, `checked` and `validate` on a form-field root, and `http-equiv` and `content` on a `<meta>` root, still fail: declare them as inputs.
- `<component>` is reserved; `@snippet name(` and `@render name(` in template text start blocks.
- Compiled templates use bundle format v3: rebuild edge bundles.
