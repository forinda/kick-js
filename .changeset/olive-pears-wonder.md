---
'@forinda/kickjs-cli': patch
---

`kick new --packages` no longer advertises `auth`.

The flag's help string read `(e.g. auth,swagger,ws,queue)`. `auth` was removed
from the catalog with the package, so the one example the flag gives is a name
that now fails.
