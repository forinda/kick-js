---
'@forinda/kickjs-cli': patch
---

`kick g module auth` creates `src/modules/auth/` (route `/auth`) instead of `auths/`. Other names still pluralize; `--no-pluralize` keeps any name singular.
