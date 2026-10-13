---
'@forinda/kickjs-cli': patch
---

`kick add` installs `h3@^1` for an h3 app instead of a bare `h3`. h3 v2 is now `latest` on npm, so the bare name upgraded an existing `^1` dependency to v2, which `h3Runtime` does not run on.
