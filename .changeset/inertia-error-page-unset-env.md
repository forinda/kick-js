---
'@forinda/kickjs-inertia': patch
---

The error page hides a 5xx exception's message unless `NODE_ENV` is `development` or `test`. It used to hide it only when `NODE_ENV` was `production`, so a deploy that forgot to set it showed the raw exception text to visitors. Migration: set `NODE_ENV=development` if you relied on seeing the message with it unset.
