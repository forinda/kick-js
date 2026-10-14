---
'@forinda/kickjs': minor
---

- `createHandler(() => import('./index'))` serves the app your entry's `bootstrap()` call describes, so a Netlify or Vercel function and the long-running server share one set of options. While the entry loads, `bootstrap()` builds the app without listening, forking or registering signal handlers. `createHandler(options)` works as before.
- `session({ secret, store: 'cookie' })` keeps the session in an encrypted cookie (AES-256-GCM, with the key derived from `secret`), so any number of instances read it with nothing shared between them: several containers, or serverless functions. A cookie that was altered or has expired starts a fresh session. A warning is logged when the data outgrows a cookie.
