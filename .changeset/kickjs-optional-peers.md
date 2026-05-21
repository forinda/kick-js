---
'@forinda/kickjs': minor
---

deps: make `multer` an optional peer dependency; remove unused `cookie-parser`

**multer** moves from `dependencies` to `peerDependencies` (range `^2.0.0`) with `peerDependenciesMeta.optional: true`. The package is now lazy-loaded via `createRequire(import.meta.url)` inside `upload.ts`, so importing `@forinda/kickjs` no longer touches `multer`. Adopters who never call `upload.single/array/none()` or use `@FileUpload` don't need it installed at all. If you do call those APIs without `multer` installed, you get a clear runtime error: `"@forinda/kickjs: file uploads require the 'multer' package, which is not installed. Install it: pnpm add multer"`.

**cookie-parser** is removed entirely. It was never imported anywhere in the source — only mentioned in a `csrf.ts` JSDoc snippet as an example of middleware adopters should wire themselves. The `@types/cookie-parser` devDep is removed too.

No breaking change for adopters who already have `multer` installed (pnpm/npm 7+ auto-install peers; pnpm strict mode surfaces a clear warning).
