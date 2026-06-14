# File Uploads

KickJS provides file upload handling via both **middleware** and a **decorator**, exposing every uploaded file on `ctx.file` / `ctx.files` in the standard Multer shape regardless of the HTTP runtime.

::: tip Runtime support
The `@FileUpload` decorator works on all three runtimes; each uses its engine's multipart backend, which you install with `kick add upload`:

| Runtime           | Multipart driver                   | Notes                                                   |
| ----------------- | ---------------------------------- | ------------------------------------------------------- |
| Express (default) | `multer`                           | Used by the `upload.single/array/none()` middleware too |
| Fastify           | `@fastify/multipart`               | Parts are buffered into the same Multer file shape      |
| h3                | built-in (`readMultipartFormData`) | No driver to install                                    |

The `upload` middleware factory and `cleanupFiles()` (disk storage, custom `StorageEngine`) are Multer-specific and therefore Express-only. On Fastify / h3, use the `@FileUpload` decorator. `kick doctor` flags a missing driver when it detects upload usage.
:::

## Middleware Approach

Import the `upload` factory from `@forinda/kickjs`:

```ts
import { upload } from '@forinda/kickjs'
```

### Single File

Attaches one file to `ctx.file`:

```ts
@Post('/avatar')
@Middleware(upload.single('avatar', { maxSize: 2 * 1024 * 1024, allowedTypes: ['jpg', 'png'] }))
async uploadAvatar(ctx: RequestContext) {
  ctx.json({ filename: ctx.file.originalname, size: ctx.file.size })
}
```

### Multiple Files

Attaches an array to `ctx.files`. The second argument is `maxCount` (default 10):

```ts
@Post('/gallery')
@Middleware(upload.array('photos', 5, { allowedTypes: ['png', 'jpeg', 'webp'] }))
async uploadGallery(ctx: RequestContext) {
  ctx.json({ count: ctx.files?.length })
}
```

### No Files (Multipart Body Only)

Parses multipart form data without accepting file fields:

```ts
@Post('/form')
@Middleware(upload.none())
async handleForm(ctx: RequestContext) {
  ctx.json(ctx.body)
}
```

## @FileUpload Decorator

The `@FileUpload` decorator is a declarative alternative. The router builder automatically attaches the upload middleware from the decorator metadata — no manual `@Middleware(upload.single(...))` needed.

```ts
import { Controller, Post, FileUpload } from '@forinda/kickjs'
import { RequestContext } from '@forinda/kickjs'

@Controller()
class FileController {
  @Post('/upload')
  @FileUpload({
    mode: 'single',
    fieldName: 'document',
    maxSize: 10_000_000,
    allowedTypes: ['pdf', 'docx'],
  })
  async handleUpload(ctx: RequestContext) {
    ctx.json({ file: ctx.file.originalname, size: ctx.file.size })
  }

  @Post('/photos')
  @FileUpload({
    mode: 'array',
    fieldName: 'photos',
    maxCount: 5,
    allowedTypes: ['jpg', 'png', 'webp'],
  })
  async handlePhotos(ctx: RequestContext) {
    ctx.json({ count: ctx.files?.length })
  }

  @Post('/avatar')
  @FileUpload({
    mode: 'single',
    fieldName: 'avatar',
    allowedTypes: (mime, filename) => mime.startsWith('image/') || filename.endsWith('.heic'),
    customMimeMap: { heic: 'image/heic' },
  })
  async handleAvatar(ctx: RequestContext) {
    ctx.json({ file: ctx.file.originalname })
  }
}
```

### FileUploadConfig

The `@FileUpload` decorator and the `upload.*()` middleware share the same base options (`BaseUploadOptions`). The decorator adds `mode`, `fieldName`, and `maxCount`.

| Option          | Type                            | Default      | Description                     |
| --------------- | ------------------------------- | ------------ | ------------------------------- |
| `mode`          | `'single' \| 'array' \| 'none'` | **required** | Upload mode                     |
| `fieldName`     | `string`                        | `'file'`     | Form field name                 |
| `maxCount`      | `number`                        | `10`         | Max files (array mode only)     |
| `maxSize`       | `number`                        | `5MB`        | Max file size in bytes          |
| `allowedTypes`  | `string[] \| FileTypeFilter`    | all          | String array or filter function |
| `customMimeMap` | `Record<string, string>`        | —            | Extend the built-in MIME map    |

::: warning Decorator is memory-only — for disk/custom storage use the middleware
`@FileUpload` has **no `storage` / `dest`** option on purpose: it buffers to memory so the same decorator works identically on Express, Fastify, and h3 (`ctx.file.buffer`). Multer's `StorageEngine` is Express-specific and can't cross engines.

To vary the storage engine per route — memory on one, disk on another, S3 on a third — use the `upload.single/array()` **middleware** (Express only), which exposes `storage` + `dest`:

```ts
import multer from 'multer'
import { upload } from '@forinda/kickjs'

// memory → ctx.file.buffer
@Post('/avatar') @Middleware(upload.single('avatar'))
avatar(ctx: RequestContext) {}

// disk → ctx.file.path
@Post('/import') @Middleware(upload.single('csv', { dest: '/tmp/uploads' }))
importCsv(ctx: RequestContext) {}

// any multer StorageEngine (multer-s3, gridfs, …)
@Post('/doc') @Middleware(upload.single('doc', { storage: multer.diskStorage({ destination: '/var/data' }) }))
doc(ctx: RequestContext) {}
```

Rule of thumb: **portable + memory → `@FileUpload`; Express-specific storage engine → `upload.*()` middleware.**
:::

## UploadOptions

All middleware methods accept an `UploadOptions` object:

| Option          | Type                       | Default                  | Description                                 |
| --------------- | -------------------------- | ------------------------ | ------------------------------------------- |
| `maxSize`       | `number`                   | `5 * 1024 * 1024` (5 MB) | Maximum file size in bytes                  |
| `allowedTypes`  | `string[] \| FileFilterFn` | all                      | String array or filter function (see below) |
| `customMimeMap` | `Record<string, string>`   | —                        | Extend the built-in extension-to-MIME map   |
| `storage`       | Multer `StorageEngine`     | memory                   | Custom Multer storage engine (Express only) |
| `dest`          | `string`                   | —                        | Disk storage destination dir, Express only  |

## Allowed Types — Value or Function

`allowedTypes` follows a Vue-style pattern: pass a **value** (string array) or a **function** for full control.

### String Array (short extensions, MIME types, or wildcards)

```ts
// Short extensions — resolved via built-in MIME map
upload.single('file', { allowedTypes: ['jpg', 'png', 'pdf'] })

// Full MIME types
upload.single('file', { allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] })

// Wildcards
upload.single('file', { allowedTypes: ['image/*'] })

// Mix all three
upload.single('file', { allowedTypes: ['jpg', 'application/pdf', 'video/*'] })
```

### Filter Function

For full control, pass a function that receives the MIME type and original filename:

```ts
// Accept images and HEIC files by extension
upload.single('file', {
  allowedTypes: (mime, filename) => mime.startsWith('image/') || filename.endsWith('.heic'),
})

// Accept anything under 2MB that isn't executable
upload.single('file', {
  allowedTypes: (mime) => !mime.includes('executable') && !mime.includes('x-msdownload'),
})
```

### Custom MIME Map

Extend the built-in extension map with your own mappings. Your entries take precedence over defaults:

```ts
upload.single('file', {
  allowedTypes: ['heic', 'jxl', 'jpg'],
  customMimeMap: {
    heic: 'image/heic',
    jxl: 'image/jxl',
  },
})
```

## Short Extension Support

The built-in MIME map covers 40+ common extensions. Use `resolveMimeTypes()` to inspect how extensions are mapped:

```ts
import { resolveMimeTypes } from '@forinda/kickjs'

resolveMimeTypes(['jpg', 'pdf', 'image/*'])
// → ['image/jpeg', 'application/pdf', 'image/*']
```

## Automatic Cleanup

For disk-stored uploads, use `cleanupFiles()` to delete temporary files after the response finishes:

```ts
import { upload, cleanupFiles } from '@forinda/kickjs'

@Post('/process')
@Middleware(upload.single('document', { dest: '/tmp/uploads' }), cleanupFiles())
async processDocument(ctx: RequestContext) {
  // Work with ctx.file.path
  // File is automatically deleted after the response is sent
  ctx.json({ ok: true })
}
```

`cleanupFiles()` listens to the `finish` event on the response. It only attempts to delete files that have a `path` property (disk-stored files). If the file was already moved or deleted by your handler, the cleanup silently ignores the missing file.

## Accessing Uploaded Files

Uploaded files are available on the `RequestContext`:

- **`ctx.file`** — the single uploaded file object (when using `single` mode)
- **`ctx.files`** — an array of uploaded files (when using `array` mode)

Each file object follows the standard Multer file shape: `originalname`, `mimetype`, `size`, `buffer` (memory storage), or `path` and `filename` (disk storage).
