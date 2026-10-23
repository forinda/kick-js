---
'@forinda/kickjs-view': patch
---

`share`'s `ctx` is typed `ShareContext | undefined` (`req` and `get()`), instead of `unknown`, so `share: (ctx) => ({ user: ctx?.get('user'), csrfToken: csrfToken(ctx) })` type-checks without a cast.
