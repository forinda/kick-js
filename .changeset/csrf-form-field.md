---
'@forinda/kickjs': minor
---

`csrf()` and `csrfGuard()` accept the token as a form field (`_csrf`, or `field` to rename it) when the `x-csrf-token` header is absent, so plain HTML forms can pass the check. `csrfToken(ctx)` returns this request's token for a page to put in its forms, including on the first visit, before the browser has the cookie.
