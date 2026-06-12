---
'@forinda/kickjs-auth': patch
---

Mark the package as deprecated — auth is moving to BYO (bring-your-own): compose `@LoadAuthUser` / `@RequireRole` / `@Public` from `defineContextDecorator` and `defineAdapter` (see the BYO Auth recipe in the docs). Importing the package now prints a one-time console warning (suppress with `KICKJS_SUPPRESS_DEPRECATION=1`) and the entry module carries `@deprecated` JSDoc. The package will be removed in a future major.
