---
'@forinda/kickjs-cli': patch
---

The Dockerfile from `kick g deploy docker` ships the `db/` folder (`server/db` in a fullstack workspace). kick/db reads its migrations at runtime — `kickDbAdapter`'s `migrationsOnBoot` check and `migrateLatest()` — and the image only carried `dist/`, so a boot or a release-step migration found no files. The build stage creates the folder, so projects without kick/db still build.
