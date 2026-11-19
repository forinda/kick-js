# Shared Data

<!-- {{ }} below is template syntax, not VitePress interpolation -->

:::: v-pre

```ts
import { csrfToken } from '@forinda/kickjs'

createViews({
  ...kickViews,
  share: (ctx) => ({
    user: ctx?.get('user'),
    cspNonce: ctx?.get('cspNonce'),
    csrfToken: csrfToken(ctx),
  }),
})
```

`share` runs for every `ctx.render`, inside the request, and its values sit under the page's own data. Set a CSP nonce in middleware with `ctx.set`; `csrfToken(ctx)` is the token [`csrf()` or `csrfGuard()`](../csrf.md#html-forms) issued for this request. Use them in the base layout and in forms:

```kick
<meta name="csrf-token" content="{{ csrfToken }}">
<script nonce="{{ cspNonce }}" src="/app.js"></script>

<form method="post" action="/tasks">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">
</form>
```

::::
