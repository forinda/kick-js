---
'@forinda/kickjs': patch
---

`@Middleware(upload.single(...))`, `upload.array()` and `upload.none()` work as route middleware. The upload handlers were Express `(req, res, next)` functions, but route middleware is called `(ctx, next)`, so Multer received the context as its request and every upload failed with `req.on is not a function`. They now accept both conventions. An oversized file answers 413 and a refused type 415, as with `@FileUpload`.
