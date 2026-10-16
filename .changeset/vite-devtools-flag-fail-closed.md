---
'@forinda/kickjs-vite': patch
---

`resolveDevtoolsFlag()` called outside a Vite build (no `command` to go by) is `true` only when `NODE_ENV` is `development` or `test`. An unset `NODE_ENV` used to turn it on.
