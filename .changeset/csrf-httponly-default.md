---
'@forinda/kickjs': minor
---

`csrf()` and `csrfGuard()` now issue the token cookie with `httpOnly: false` by default.

**Behaviour change.** The previous default was `true`, which made the documented client flow impossible: double-submit CSRF requires the page to read the token cookie and echo it in a header, and an `httpOnly` cookie is invisible to `document.cookie`. Following the guide produced no `x-csrf-token` header and a `403` on every mutating request.

The token is not a credential — it is only compared against the cookie the browser already sends — so a token an attacker cannot read is also one your own page cannot send.

**If you deliver the token some other way** (rendered into the page by the server, or fetched from an endpoint of your own) and want the cookie kept out of JavaScript, restore the old behaviour explicitly:

```ts
csrf({ cookieOptions: { httpOnly: true } })
csrfGuard({ cookieOptions: { httpOnly: true } })
```

Nothing else about the cookie changed: `sameSite: 'strict'`, `secure` in production, and `path: '/'` are unchanged.
