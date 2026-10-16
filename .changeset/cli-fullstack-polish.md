---
'@forinda/kickjs-cli': patch
---

Fullstack scaffold: the server entry writes `SpaAdapter({ clientDir: '../web/dist' })` in single quotes, as oxfmt does; the root `typecheck` script runs `kick typecheck --cwd web --no-typegen`, so it no longer leaves a stray `web/.kickjs`; and `web/` ships the same `.oxfmtrc.json` as the server.
