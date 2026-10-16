---
'@forinda/kickjs-cli': patch
---

`kick add` no longer refuses to wire a fresh project. It only stops for tracked files with unstaged changes; files git doesn't track yet (a `kick new` before its first commit, or one inside a parent repository) and staged changes don't block it. The message now says to commit, stage or stash, or to rerun with `--force`.
