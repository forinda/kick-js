---
'@forinda/kickjs-cli': patch
---

With pluralizing on (`--pluralize` or `modules: { pluralize: true }`), `kick g module auth` creates `src/modules/auth/` (route `/auth`) instead of `auths/`. Other names still pluralize when it is on; `--no-pluralize` keeps any name singular.
