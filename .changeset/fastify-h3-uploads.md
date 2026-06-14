---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
---

File uploads (`@FileUpload` → `ctx.file` / `ctx.files`) now work on all three runtimes, and the CLI grew runtime-aware tooling around them.

**`@forinda/kickjs`**

- Fastify and h3 runtimes implement file uploads (previously gated `capabilities.uploads: false`). Fastify buffers multipart parts via `@fastify/multipart` (new optional peer); h3 uses its built-in `readMultipartFormData`. Both produce the same Multer-shaped file objects as Express, so `@FileUpload` and `ctx.file` / `ctx.files` behave identically across engines. Conformance-tested under all three.
- New shared helpers in `middleware/upload.ts`: `buildFileTypeFilter`, `applyUploadConfig` (enforces field name, type filter, per-file `maxSize`, array `maxCount`).
- Added `HttpStatus.PAYLOAD_TOO_LARGE` (413) and `HttpStatus.UNSUPPORTED_MEDIA_TYPE` (415).
- The runtime subpaths export their engine-native type maps: `FastifyRuntimeTypes` (`@forinda/kickjs/fastify`) and `H3RuntimeTypes` (`@forinda/kickjs/h3`), for the `KickRuntimeRegister` escape-hatch augmentation.

**`@forinda/kickjs-cli`**

- `KickConfig.runtime?: 'express' | 'fastify' | 'h3'` — written by `kick new --runtime`, read by dep-aware commands.
- `kick add upload` installs the multipart driver for the project's runtime: Express → `multer` (+ `@types/multer`), Fastify → `@fastify/multipart`, h3 → none (native).
- New `kick/runtime` typegen plugin emits the `KickRuntimeRegister` augmentation from `config.runtime`, retyping `ctx.req` / `ctx.res` / `AdapterContext.app` / `getRuntimeApp()` to the active engine (Express stays the default, no augmentation emitted).
- `kick doctor` gains two checks: the configured runtime's engine peers are installed, and — when upload usage is detected in `src/` — the matching multipart driver is present.
