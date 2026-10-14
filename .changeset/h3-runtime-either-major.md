---
'@forinda/kickjs': minor
---

`h3Runtime()` runs on whichever h3 major is installed. With h3 v2 it uses the web-standard runtime (the one behind `h3WebRuntime()` and `@forinda/kickjs/web`); with h3 v1 it keeps the node-based runtime and logs a one-time notice that v1 support ends in the next major. Upgrading an app is `pnpm add h3@^2`. `h3Runtime({ h3 })` takes a pre-imported module, and `H3RuntimeTypes` follows the installed major.
