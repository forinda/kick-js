---
'@forinda/kickjs-view': minor
---

Forms: every template, components included, gets `$errors`, `$old` and `$flash` from the request's session, each shown once. A controller's own `$errors` / `$old` in the render data win, for re-rendering a form. `@error('field') { … }` renders a field's error as `$message`. Named inputs, textareas, selects, checkboxes and radios refill from `$old` on their own, unless the template sets their value, and never for passwords, files, hidden fields or secret-looking names.
