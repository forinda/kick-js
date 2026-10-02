---
'@forinda/kickjs-cli': patch
---

`kick g module <name> --no-pluralize` (and `--no-tests` / `--no-entity`, on `module` and `scaffold`) were ignored when written after the subcommand: `kick g` declares the same flags, Commander bound them to it, and the subcommand's default won. A `false` from either now wins, so `kick g module auth --no-pluralize` writes `src/modules/auth/`.
