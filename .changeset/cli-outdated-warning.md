---
'@forinda/kickjs-cli': minor
---

`kick new` warns when the running CLI is behind the latest release: an old global `kick` silently lacks the templates and options added since (Inertia, for one). Interactively the warning comes before the template list; with `--yes`, after scaffolding. Offline, it says nothing.
