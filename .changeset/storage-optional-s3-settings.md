---
'@forinda/kickjs-storage': minor
'@forinda/kickjs-cli': patch
---

`StorageAdapter` takes a `settings` option: more sections to declare beside the storage's own. The file `kick add storage` writes passes `settings: [S3Settings.optional()]`, so `kick env example` keeps listing the `S3_*` variables while files are on disk instead of dropping the lines `kick add storage` appended; with `S3_BUCKET` set, the section is still required at startup. Those appended lines now match what `kick env example` writes. `@forinda/kickjs-storage` now needs `@forinda/kickjs` 10.14 or later, for `.optional()`.
