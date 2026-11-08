---
'@forinda/kickjs': patch
'@forinda/kickjs-devtools': patch
---

`app.configOrigins()` lists sections declared `.optional()` too, marked `optional: true`, after the bound ones. They were left out, so the devtools Config panel didn't show a section like the `kick add storage` file's `S3Settings.optional()` while files were on disk. The panel labels them "(optional)".
