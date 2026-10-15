---
description: Save uploaded files to memory, local disk, or an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) behind one interface, with signed download URLs and no AWS SDK.
---

# File Storage

`@forinda/kickjs-storage` puts every place an app keeps files behind one `Storage` interface. The code that saves an avatar stays the same when it moves from a local folder in development to a bucket in production, or to memory in tests.

<PmCommand add="@forinda/kickjs-storage" />

Or `kick add storage`. It has no SDK dependency: the S3 driver signs requests itself (AWS Signature V4) and sends them with `fetch`.

## The interface

```ts
interface Storage {
  put(key: string, body: Uint8Array | string, options?: { contentType?: string }): Promise<void>
  get(key: string): Promise<Uint8Array | null> // null when there is no such file
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void> // a missing key is not an error
  url(key: string, options?: { expiresIn?: number }): Promise<string>
}
```

Three drivers implement it:

| Driver                                | For                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `memoryStorage({ baseUrl? })`         | Tests. Files live in a `Map` and are gone when the process exits.                          |
| `diskStorage({ root, baseUrl? })`     | A directory on the server. Writes go to a temp file and are renamed into place.            |
| `s3Storage({ bucket, region?, ... })` | AWS S3, Cloudflare R2, MinIO, and other S3-compatible APIs. `url()` returns a signed link. |

## Saving an upload

Bind a token to a driver, then inject it where files are saved:

```ts
// src/modules/files/files.ts
import { createToken } from '@forinda/kickjs'
import { diskStorage, s3Storage, type Storage } from '@forinda/kickjs-storage'

export const FILES = createToken<Storage>('Files')

export const createFiles = (): Storage =>
  process.env.NODE_ENV === 'production'
    ? s3Storage({
        bucket: 'avatars',
        region: 'eu-west-1',
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      })
    : diskStorage({ root: './uploads', baseUrl: '/uploads' })
```

```ts
// in the module
register(container: Container) {
  container.registerFactory(FILES, createFiles)
}
```

```ts
@Controller()
class AvatarController {
  @Autowired(FILES) private files!: Storage

  @Post('/')
  @FileUpload({ mode: 'single', fieldName: 'avatar', allowedTypes: ['png', 'jpg'] })
  async upload(ctx: RequestContext) {
    const key = `avatars/${randomUUID()}`
    await this.files.put(key, ctx.file!.buffer, { contentType: ctx.file!.mimetype })
    ctx.json({ key, url: await this.files.url(key, { expiresIn: 600 }) })
  }
}
```

[File Uploads](./file-uploads.md) covers `@FileUpload`, which buffers the file to memory on every runtime, so `ctx.file.buffer` is what you pass to `put()`.

## Keys

A key is a `/`-separated path, like `avatars/42.png`. Every driver refuses a key that is empty, starts with `/`, has an empty, `.` or `..` segment, or contains `\` or NUL. So a key built from user input can't reach outside the disk root or into another object. `checkKey(key)` runs the same check if you want it earlier.

Build keys from ids you control, such as `avatars/${user.id}.png` or a `randomUUID()`, not from the uploaded file's name. Two users uploading `photo.jpg` would otherwise overwrite each other.

## URLs

- **Buckets:** `url(key, { expiresIn })` returns a presigned GET URL that works for `expiresIn` seconds. The default is 3600 and the maximum is 604800 (7 days), which is S3's limit. The bucket can stay private.
- **Disk and memory:** `url(key)` is `baseUrl` followed by the key, each segment URL-encoded. Without `baseUrl` it throws. Serving that directory is up to the app, for example with `express.static('./uploads')` mounted at `/uploads`, or behind a CDN. These URLs don't expire, so don't put private files under a public `baseUrl`.

## Cloudflare R2, MinIO and other S3-compatible services

Pass `endpoint`. Objects are then addressed path-style, as `<endpoint>/<bucket>/<key>`:

```ts
// Cloudflare R2
s3Storage({
  bucket: 'avatars',
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  accessKeyId,
  secretAccessKey,
})

// MinIO in development
s3Storage({
  bucket: 'avatars',
  endpoint: 'http://localhost:9000',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin',
})
```

Without `endpoint`, the driver uses AWS's virtual-hosted address, `https://<bucket>.s3.<region>.amazonaws.com`.

`forcePathStyle` overrides that choice in either direction:

- `forcePathStyle: false` with an `endpoint` addresses `https://<bucket>.<endpoint host>/<key>`. Use it for a provider that only serves virtual-hosted URLs.
- `forcePathStyle: true` without one addresses `https://s3.<region>.amazonaws.com/<bucket>/<key>`. Use it for an AWS bucket name containing dots, which breaks TLS on the virtual-hosted address. Temporary credentials take a `sessionToken`. `fetch` replaces the global one, for a proxy or a test.

## Config from the environment

`@forinda/kickjs-storage/settings` has a [settings section](./configuration.md) for a bucket. It is validated when the app starts and listed by `kick env example`:

```bash
# .env
S3_BUCKET=avatars
S3_REGION=eu-west-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
# S3_SESSION_TOKEN=...
# S3_FORCE_PATH_STYLE=true
```

```ts
import { S3Settings, s3FromSettings } from '@forinda/kickjs-storage/settings'

bootstrap({ modules, settings: [S3Settings] })

// in the module
container.registerFactory(FILES, () => s3FromSettings())
```

`s3FromSettings()` reads the section on first use, after the app has bound it. A missing `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY`, an `S3_ENDPOINT` that isn't a URL, or an `S3_FORCE_PATH_STYLE` other than `true` / `false`, stops startup with every problem listed.

A second bucket reads its own variables through `S3Settings.scoped('BACKUPS')`, which reads `BACKUPS_S3_BUCKET`, `BACKUPS_S3_ACCESS_KEY_ID`, and so on. Declare it in `settings` too, and pass it as `s3FromSettings(Backups)`.

## In tests

Bind the token to `memoryStorage()` and read back what the handler stored:

```ts
const files = memoryStorage()
const { client } = await createTestApp({
  modules,
  overrides: [[FILES, files]],
})

const res = await client().post('/api/v1/avatars').attach('avatar', png, 'a.png').expect(200)
expect(await files.exists(res.body.key)).toBe(true)
```

Or keep the S3 driver and give it a value with `S3Settings.provide({ bucket, endpoint, accessKeyId, secretAccessKey })` that points at a MinIO container.

## Limits

- **Whole files in memory.** `put()` takes bytes and `get()` returns them, which suits avatars and documents. A multi-gigabyte upload should go straight from the browser to the bucket through a presigned upload URL; that isn't built yet.
- **No listing.** There is no `list(prefix)`. Keep the keys you need in your database.
- **`contentType`** is kept by buckets and ignored by disk and memory. For those, the server serving the files picks the type from the extension.
- **Node only.** The package uses `node:crypto` and `node:fs`. On Cloudflare Workers, use the R2 binding directly.
