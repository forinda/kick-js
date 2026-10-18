---
'@forinda/kickjs': minor
---

Every uploaded file now carries a server-side `filename` on every runtime: a random UUID plus the client name's extension when that extension names the file's type (`photo.png` as `image/png` keeps `.png`; `evil.html` as `image/png` gets none), or the name `@FileUpload({ rename })` / `upload.single(..., { rename })` returns, checked to contain no slash or backslash and to be neither `.` nor `..`. Store files under `filename`, never `originalname`. Disk storage (`dest`) keeps the name it wrote the file under.

`originalname` is normalized to Unicode NFC, without a directory part or control characters. On Express, multer read a non-ASCII file name (Chinese, an emoji) as Latin-1, so it arrived as mojibake; it now arrives intact, as it already did on Fastify and h3.
