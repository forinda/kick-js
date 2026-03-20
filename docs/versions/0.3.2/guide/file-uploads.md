# File Uploads

KickJS wraps Multer to provide a clean file upload API with middleware helpers and a declarative decorator.

## Upload Middleware

Import the `upload` factory from `@forinda/kickjs-http`:

```ts
import { upload } from '@forinda/kickjs-http'
```

### Single File

Attaches one file to `ctx.file`:

```ts
@Post('/avatar')
@Middleware(upload.single('avatar', { maxSize: 2 * 1024 * 1024, allowedTypes: ['image/*'] }))
async uploadAvatar(ctx: RequestContext) {
  ctx.json({ filename: ctx.file.originalname, size: ctx.file.size })
}
```

### Multiple Files

Attaches an array to `ctx.files`. The second argument is `maxCount` (default 10):

```ts
@Post('/gallery')
@Middleware(upload.array('photos', 5, { allowedTypes: ['image/png', 'image/jpeg'] }))
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

## UploadOptions

All three methods accept an `UploadOptions` object:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxSize` | `number` | `5 * 1024 * 1024` (5 MB) | Maximum file size in bytes |
| `allowedTypes` | `string[]` | all | MIME types to accept. Supports wildcards like `image/*` |
| `storage` | Multer `StorageEngine` | memory | Custom Multer storage engine |
| `dest` | `string` | -- | Shorthand for disk storage destination directory |

When `allowedTypes` is set, any file with a non-matching MIME type triggers an error with the message `"File type <mime> is not allowed"`.

## Automatic Cleanup

For disk-stored uploads, use `cleanupFiles()` to delete temporary files after the response finishes:

```ts
import { upload, cleanupFiles } from '@forinda/kickjs-http'

@Post('/process')
@Middleware(upload.single('document', { dest: '/tmp/uploads' }), cleanupFiles())
async processDocument(ctx: RequestContext) {
  // Work with ctx.file.path
  // File is automatically deleted after the response is sent
  ctx.json({ ok: true })
}
```

`cleanupFiles()` listens to the `finish` event on the response. It only attempts to delete files that have a `path` property (disk-stored files). If the file was already moved or deleted by your handler, the cleanup silently ignores the missing file.

## @FileUpload Decorator

The `@FileUpload` decorator stores upload configuration as metadata on a controller method. This is useful when a framework-level router reads the metadata to wire up upload middleware automatically.

```ts
import { FileUpload } from '@forinda/kickjs-core'

@Post('/upload')
@FileUpload({ mode: 'single', fieldName: 'file', maxSize: 10_000_000, allowedMimeTypes: ['application/pdf'] })
async handleUpload(ctx: RequestContext) {
  ctx.json({ file: ctx.file.originalname })
}
```

### FileUploadConfig

```ts
interface FileUploadConfig {
  mode: 'single' | 'array' | 'none'
  fieldName?: string
  maxCount?: number        // only relevant for 'array' mode
  maxSize?: number
  allowedMimeTypes?: string[]
}
```

## Accessing Uploaded Files

Uploaded files are available on the `RequestContext`:

- **`ctx.file`** -- the single uploaded file object (when using `single` mode)
- **`ctx.files`** -- an array of uploaded files (when using `array` mode)

Each file object follows the standard Multer file shape: `originalname`, `mimetype`, `size`, `buffer` (memory storage), or `path` and `filename` (disk storage).
