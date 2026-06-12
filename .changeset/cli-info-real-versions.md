---
'@forinda/kickjs-cli': patch
---

`kick info` now reports real data instead of a hardcoded three-package "workspace" list: the CLI's own version, plus every `@forinda/kickjs*` dependency the project declares with the version actually installed in `node_modules` (falling back to the declared range when not installed) and a `[DEPRECATED]` flag for packages the `kick add` catalog marks as deprecated. `kick -v` now works as an alias for `-V` / `--version`.
