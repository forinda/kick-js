---
description: Save, stream and list files in memory, on local disk, or in an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO) behind one interface — with signed URLs, uploads straight from the browser, resumable multipart uploads, and a tus endpoint for resumable uploads through your server. No AWS SDK.
---

# File Storage

`@forinda/kickjs-storage` puts every place an app keeps files behind one `Storage` interface. The code that saves an avatar stays the same when it moves from a local folder in development to a bucket in production, or to memory in tests.

<PmCommand add="@forinda/kickjs-storage" />

Or `kick add storage`. It has no SDK dependency: the S3 driver signs requests itself (AWS Signature V4) and sends them with `fetch`.

The main entry, with `memoryStorage` and `s3Storage`, uses only `fetch` and WebCrypto, so it runs on Node, Bun, Deno and Cloudflare Workers. `diskStorage` is Node only and comes from `@forinda/kickjs-storage/disk`.

## The interface

```ts
interface Storage {
  put(key: string, body: Body, options?: { contentType?: string }): Promise<void>
  putIfAbsent(key: string, body: Body, options?: { contentType?: string }): Promise<boolean>
  get(key: string): Promise<Uint8Array | null> // null when there is no such file
  getStream(key: string): Promise<ReadableStream<Uint8Array> | null>
  stat(key: string): Promise<FileInfo | null> // { key, size, lastModified, contentType? }
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void> // a missing key is not an error
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<ListPage>
  url(key: string, options?: { expiresIn?: number }): Promise<string>
}

// Bytes, text, or a stream: a web ReadableStream or a Node Readable
type Body = Uint8Array | string | AsyncIterable<Uint8Array>
```

Three drivers implement it:

| Driver                                | For                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `memoryStorage({ baseUrl? })`         | Tests. Files live in a `Map` and are gone when the process exits.                                                   |
| `diskStorage({ root, baseUrl? })`     | A directory on the server. Writes go to a temp file and are renamed into place.                                     |
| `s3Storage({ bucket, region?, ... })` | AWS S3, Cloudflare R2, MinIO, and other S3-compatible APIs. Adds [direct uploads](#uploads-straight-to-the-bucket). |

## Saving an upload

Bind a token to a driver, then inject it where files are saved:

```ts
// src/modules/files/files.ts
import { createToken } from '@forinda/kickjs'
import { s3Storage, type Storage } from '@forinda/kickjs-storage'
import { diskStorage } from '@forinda/kickjs-storage/disk'

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

## Streaming

`put()` takes a stream as well as bytes. Disk writes it to the file as it arrives. A bucket gets one request if the stream fits in one part, and a multipart upload if not, with four parts in flight at once. A failed part aborts the upload, so no half-written parts are left behind. Memory use stays at about `partSize` × `partConcurrency` (20 MiB by default) however large the file is. Tune both on `s3Storage`: `partSize` is at least 5 MiB, S3's minimum, and since S3 allows 10,000 parts, raise it for streams over about 48 GiB.

```ts
import { createReadStream } from 'node:fs'

await files.put('exports/2026-10.csv', createReadStream('/tmp/export.csv'), {
  contentType: 'text/csv',
})
```

`getStream()` reads without holding the file in memory. Hand it to `ctx.sendResponse()` to send it on, on any runtime:

```ts
@Get('/:id/download')
async download(ctx: RequestContext) {
  const key = `reports/${ctx.params.id}.pdf`
  const [info, body] = await Promise.all([this.files.stat(key), this.files.getStream(key)])
  if (!info || !body) return ctx.problem.notFound()
  await ctx.sendResponse(
    new Response(body, {
      headers: { 'content-type': info.contentType ?? 'application/pdf', 'content-length': String(info.size) },
    }),
  )
}
```

For a bucket, redirecting to `await files.url(key)` is usually better: the browser downloads straight from the bucket and your server sends nothing.

## Listing

`list()` returns files whose key starts with `prefix`, in key order, up to `limit` (default and maximum 1000) at a time. Pass the returned `cursor` back for the next page. No `cursor` means it was the last page.

```ts
let cursor: string | undefined
do {
  const page = await files.list({ prefix: `users/${userId}/`, cursor })
  for (const file of page.files) await files.delete(file.key)
  cursor = page.cursor
} while (cursor)
```

Listing isn't split into folders: `prefix: 'a/'` includes `a/b/c.txt`. On disk, a page reads only the folders it needs: the ones that can hold keys after the cursor and under the prefix. A folder with a very large number of files is still read whole each time a page passes through it.

## Create-only writes: `putIfAbsent`

`putIfAbsent(key, body)` stores the body only if nothing is stored under `key` yet. It returns `true` when it stored it and `false` when the key was taken. It is atomic: of several callers racing for the same key, on one server or many, exactly one gets `true`. Use it for idempotency markers, claims and "first writer wins" records:

```ts
// Process a webhook once, however many times it is delivered.
if (!(await files.putIfAbsent(`webhooks/${event.id}`, JSON.stringify(event)))) return
await handle(event)
```

Buckets use S3 conditional writes (`If-None-Match: *`), which AWS S3, Cloudflare R2 and MinIO support. Disk uses an atomic hard link. The body is read into memory first, so this is for small objects.

## Keys

A key is a `/`-separated path, like `avatars/42.png`. Every driver refuses a key that is empty, starts with `/`, has an empty, `.` or `..` segment, or contains `\` or NUL. So a key built from user input can't reach outside the disk root or into another object. `checkKey(key)` runs the same check if you want it earlier.

Build keys from ids you control, such as `avatars/${user.id}.png` or a `randomUUID()`, not from the uploaded file's name. Two users uploading `photo.jpg` would otherwise overwrite each other.

## Where disk files go

A relative `root` resolves from `process.cwd()` when `diskStorage()` is called. That is the same base KickJS uses for `.env` files, assets and the SPA adapter, so `./uploads` sits next to them in the project root. Run `kick dev` and `kick start` from the project root, and in production set the working directory (Docker `WORKDIR`, systemd `WorkingDirectory`, pm2 `cwd`). To put files elsewhere, pass an absolute path, such as `/var/lib/myapp/uploads` on a mounted volume.

## URLs

- **Buckets:** `url(key, { expiresIn })` returns a presigned GET URL that works for `expiresIn` seconds. The default is 3600 and the maximum is 604800 (7 days), which is S3's limit. The bucket can stay private.
- **Disk and memory:** `url(key)` is `baseUrl` followed by the key, each segment URL-encoded. Without `baseUrl` it throws. Serving that directory is up to the app, for example with `express.static('./uploads')` mounted at `/uploads`, or behind a CDN. These URLs don't expire, so don't put private files under a public `baseUrl`.

## Uploads straight to the bucket

Large files shouldn't pass through your server. With `s3Storage`, the server signs a URL and the browser sends the file directly to the bucket. Your server checks who may upload what, picks the key, and never handles the bytes.

### One request: `uploadUrl()`

```ts
const MAX = 20 * 1024 * 1024

@Post('/uploads')
async start(ctx: RequestContext) {
  const { size, type } = ctx.body as { size: number; type: string }
  if (size > MAX) throw HttpException.badRequest('File too large')
  if (!['image/png', 'image/jpeg'].includes(type)) throw HttpException.badRequest('Unsupported type')

  const key = `uploads/${ctx.get('user')!.id}/${randomUUID()}`
  ctx.json({ key, url: await this.files.uploadUrl(key, { size, contentType: type, expiresIn: 300 }) })
}
```

```ts
// browser
const { key, url } = await api.post('/uploads', { size: file.size, type: file.type })
await fetch(url, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
```

`size` and `contentType` are signed into the URL, so the bucket refuses a body of any other size or a different `Content-Type`. Check them against your limits before you sign. Without `size`, the URL accepts any size up to S3's 5 GiB limit for a single upload. When the browser reports success, `files.stat(key)` confirms the file arrived and how big it is.

### Large and resumable: `multipart`

A multipart upload sends the file in parts, each through its own signed URL. A dropped connection costs one part, not the whole file. If the page reloads, `listParts()` says which parts the bucket already has, so only the rest are sent. The server needs five endpoints:

```ts
@Controller()
class MultipartController {
  @Autowired(FILES) private files!: S3Storage

  // Every key is under the user's own prefix, so no one can touch another user's upload.
  private own(ctx: RequestContext, key: string) {
    if (!key.startsWith(`uploads/${ctx.get('user')!.id}/`)) throw HttpException.forbidden()
    return key
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const { type } = ctx.body as { type: string }
    const key = `uploads/${ctx.get('user')!.id}/${randomUUID()}`
    ctx.json({ key, uploadId: await this.files.multipart.create(key, { contentType: type }) })
  }

  @Post('/part')
  async part(ctx: RequestContext) {
    const { key, uploadId, partNumber } = ctx.body as {
      key: string
      uploadId: string
      partNumber: number
    }
    ctx.json({ url: await this.files.multipart.partUrl(this.own(ctx, key), uploadId, partNumber) })
  }

  @Post('/parts')
  async parts(ctx: RequestContext) {
    const { key, uploadId } = ctx.body as { key: string; uploadId: string }
    ctx.json(await this.files.multipart.listParts(this.own(ctx, key), uploadId))
  }

  @Post('/complete')
  async complete(ctx: RequestContext) {
    const { key, uploadId, parts } = ctx.body as {
      key: string
      uploadId: string
      parts: CompletedPart[]
    }
    this.own(ctx, key)
    // The parts the bucket really has, not what the browser claims.
    const size = (await this.files.multipart.listParts(key, uploadId)).reduce(
      (sum, p) => sum + p.size,
      0,
    )
    if (size > MAX) {
      await this.files.multipart.abort(key, uploadId)
      throw HttpException.badRequest('File too large')
    }
    await this.files.multipart.complete(key, uploadId, parts)
    ctx.json({ key })
  }

  @Post('/abort')
  async abort(ctx: RequestContext) {
    const { key, uploadId } = ctx.body as { key: string; uploadId: string }
    await this.files.multipart.abort(this.own(ctx, key), uploadId)
    ctx.noContent()
  }
}
```

The browser splits the file and sends each part to its URL. It keeps the `ETag` header from each response, because `complete` needs it. Parts are numbered from 1 to 10000, and every part except the last must be at least 5 MiB.

[Uppy](https://uppy.io/docs/aws-s3/) does this client side, with retries, progress and resume after a reload. Its `@uppy/aws-s3` plugin in multipart mode takes five functions (`createMultipartUpload`, `signPart`, `listParts`, `completeMultipartUpload` and `abortMultipartUpload`), and each one maps to one of the endpoints above.

### Bucket setup

- **CORS.** The browser calls the bucket directly, so the bucket needs a CORS rule that allows your origin to `PUT`. For multipart, the rule must also expose the `ETag` header, or the browser can't read it:

  ```json
  [
    {
      "AllowedOrigins": ["https://app.example.com"],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"]
    }
  ]
  ```

- **Abandoned uploads.** Parts of an upload that is never completed or aborted stay in the bucket and are billed. Add a lifecycle rule that aborts incomplete multipart uploads after a day or so (`AbortIncompleteMultipartUpload` on S3, and the same option on R2).

## Resumable uploads through your server: tus

When files should pass through your own server, use `TusAdapter`. This suits disk storage, a bucket you don't want browsers writing to, or a server that checks each file. It speaks [tus](https://tus.io), the open protocol for resumable uploads, so [tus-js-client](https://github.com/tus/tus-js-client), [Uppy](https://uppy.io/docs/tus/) (`@uppy/tus`) and tus clients for iOS, Android and other platforms work with it unchanged.

```ts
import { TusAdapter } from '@forinda/kickjs-storage/tus'

bootstrap({
  modules,
  adapters: [
    TusAdapter({
      path: '/api/uploads',
      storage: FILES, // a Storage, or a token bound to one
      maxSize: 2 * 1024 ** 3,
      onCreate: ({ headers, metadata, size }, id) => {
        const user = verifyToken(headers.authorization) // throw HttpException.unauthorized() to refuse
        if (!['video/mp4', 'application/pdf'].includes(metadata.filetype)) {
          throw HttpException.badRequest('Unsupported file type')
        }
        return { key: `uploads/${user.id}/${id}`, data: { owner: user.id } }
      },
      authorize: (headers, upload) => {
        if (verifyToken(headers.authorization).id !== (upload.data as { owner: string }).owner) {
          throw HttpException.forbidden()
        }
      },
      onComplete: (upload) => uploads.upsert(upload.id, { key: upload.key, size: upload.size }),
    }),
  ],
})
```

```ts
// browser
import { Upload } from 'tus-js-client'

new Upload(file, {
  endpoint: '/api/uploads',
  headers: { authorization: `Bearer ${token}` },
  metadata: { filename: file.name, filetype: file.type },
  chunkSize: 8 * 1024 * 1024,
  onProgress: (sent, total) => render(sent / total),
}).start()
```

How it works:

- **Arrival.** Each upload is written to a file under `dir` (default `.tus`) as it arrives. If the connection drops, the bytes already received stay, and the client asks (`HEAD`) where to continue and sends only the rest. tus-js-client remembers upload URLs across page reloads.
- **Completion.** When the last byte arrives, the file is streamed into `storage` under the key `onCreate` chose (default `uploads/<id>`), with `metadata.filetype` as its content type. Then `onComplete` runs. The response to that last request waits for both, so a client that sees success knows the file is stored. If storing or `onComplete` fails, the client gets a 500 and its retry runs both again. So `onComplete` runs at least once, and can run twice if it succeeded but the step after it failed. Make it idempotent, for example an upsert keyed by `upload.id`.
- **Checks.** `onCreate` sees every new upload's headers, size and metadata before anything is written. `authorize` sees every later request to that upload. Without `authorize`, anyone holding an upload's URL, which contains an unguessable id, can continue or cancel it. Throw an `HttpException` from either hook to refuse with its status.
- **Limits.** `maxSize` (default 1 GiB) is checked against the declared length, and the body can never run past it. Unfinished uploads expire `expiresIn` seconds (default one day) after their last write and are swept hourly.
- **Middleware.** The adapter runs after the global middleware, so `cors()`, rate limits and `csrf()` apply. Pass the CSRF header through tus-js-client's `headers`. For a browser on another origin, `cors()` must expose the tus headers: `exposedHeaders: ['Location', 'Upload-Offset', 'Upload-Length', 'Upload-Expires', 'Tus-Resumable']`.
- **Several instances.** Unfinished uploads live on local disk. Either give every instance the same `dir` on a shared volume, or have the load balancer send an upload's requests to one instance. Parts already received are never lost; a request that reaches the wrong instance gets 404, and the client starts over.

The protocol is tus 1.0.0 with the creation, creation-with-upload, termination and expiration extensions. For a server that isn't KickJS, `createTusHandler(options)` from the same entry is the same endpoint as a Node `(req, res, next)` handler.

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
- `forcePathStyle: true` without one addresses `https://s3.<region>.amazonaws.com/<bucket>/<key>`. Use it for an AWS bucket name containing dots, which breaks TLS on the virtual-hosted address.

Temporary credentials take a `sessionToken`. `fetch` replaces the global one, for a proxy or a test.

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

To test direct uploads, or the S3 driver itself, start a real MinIO with `startService('minio')` from `@forinda/kickjs-testing`. It comes up with an empty `test` bucket and the credentials `minioadmin` / `minioadmin`:

```ts
const minio = await startService('minio')
afterAll(() => minio.stop())

await createTestApp({
  modules,
  settings: [
    S3Settings.provide({
      bucket: 'test',
      endpoint: minio.url,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    }),
  ],
})
```

## Limits

- **Direct and multipart uploads are bucket only.** `uploadUrl()` and `multipart` exist on `s3Storage` (typed `S3Storage`), not on disk or memory. In development, run MinIO, as shown in [In tests](#in-tests).
- **tus checksums and concatenation** (parallel uploads of one file) aren't supported. Clients fall back to plain sequential uploads.
- **Disk can't hold both `a` and `a/b`.** On disk, a key is a file and a key prefix is a folder, so `put('a/b')` after `put('a')`, or the reverse, throws a clear error. Buckets and memory allow both.
- **Disk doesn't follow symbolic links.** A key that leads through a link inside the root, or names a link, is refused, so a link can't expose files outside the root.
- **`contentType`** is kept by buckets and memory, and ignored by disk. For disk, the server serving the files picks the type from the extension.
- **Edge runtimes.** `memoryStorage` and `s3Storage` run on Workers, Bun and Deno, so a Worker can reach R2 through its S3 API with an access key. `diskStorage`, `TusAdapter` and the settings entry are Node only.
