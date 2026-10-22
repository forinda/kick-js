---
'@forinda/kickjs-view': minor
---

Browser validators. `validate="required | minLength:3"` on a named field gives instant feedback before a form is sent. The available validators are `required`, `email`, `url`, `minLength`, `maxLength`, `min`, `max`, `pattern` and `in`, and the check refuses unknown or malformed ones. Messages go into the field's `@error` spot, which also gets `setCustomValidity`. Submitting with an invalid field is stopped and focuses the first one. A page with a `validate` field ships one small validator script (`/_kick/c/kick-validate.<hash>.js`); other pages ship none. `@error('field')` now always renders a `<span data-kick-error="field">` spot, hidden while there's no error, so its output changes from the bare body to the body inside that span.
