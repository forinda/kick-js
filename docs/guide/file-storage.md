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

## Setting it up

`kick add storage`, or `kick new --packages storage`, installs the package and writes `src/adapters/storage.ts`:

```ts
// src/adapters/storage.ts
import { StorageAdapter } from '@forinda/kickjs-storage/adapter'
import { diskStorage } from '@forinda/kickjs-storage/disk'
import { s3FromSettings } from '@forinda/kickjs-storage/settings'

export { STORAGE } from '@forinda/kickjs-storage/adapter'
export type { Storage } from '@forinda/kickjs-storage'

export const storageAdapter = () =>
  StorageAdapter({
    storage: process.env.S3_BUCKET ? s3FromSettings() : diskStorage({ root: 'uploads' }),
  })
```

It also adds `storageAdapter()` to `bootstrap({ adapters })`, the `S3_*` variables to `.env.example`, and `uploads/` and `.tus/` to `.gitignore`. Files go to the `uploads/` folder until `S3_BUCKET` is set, then to that bucket. Change the file to pick drivers differently.

`StorageAdapter({ storage })` binds the storage to the `STORAGE` token, so it can be injected anywhere. A storage from `s3FromSettings()` also brings its settings section, so a missing `S3_BUCKET` stops startup. The adapter reports to `/health/ready`: it lists one file, and a storage that can't be listed (an unreachable bucket, rejected credentials) reports `down`. A second storage binds its own token:

```ts
const BACKUPS = createToken<Storage>('app/storage/backups')

adapters: [
  storageAdapter(),
  StorageAdapter.scoped('backups', {
    storage: s3FromSettings(S3Settings.scoped('BACKUPS')),
    token: BACKUPS,
  }),
]
```

## Saving an upload

```ts
@Controller()
class AvatarController {
  @Autowired(STORAGE) private files!: Storage

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

Without a delimiter, listing isn't split into folders: `prefix: 'a/'` includes `a/b/c.txt`. On disk, a page reads only the folders it needs: the ones that can hold keys after the cursor and under the prefix. Each folder's sorted listing is kept until the folder changes (a file added or removed), so paging through a folder of a million files reads it once.

### Folders: `delimiter`

Pass `delimiter: '/'` to list one level at a time, as a file browser does. Keys that continue past the next `/` collapse into a single entry in `prefixes`:

```ts
const page = await files.list({ prefix: 'users/42/', delimiter: '/' })
page.files // users/42/avatar.png, users/42/cv.pdf
page.prefixes // ['users/42/invoices/', 'users/42/photos/']
```

Files and prefixes are counted together against `limit` and paged together, the same as S3's `CommonPrefixes`. Open a folder by listing it as the next `prefix`. On disk, a folder with no files in it isn't a prefix, which matches buckets, where folders exist only through the keys in them.

## Create-only writes: `putIfAbsent`

`putIfAbsent(key, body)` stores the body only if nothing is stored under `key` yet. It returns `true` when it stored it and `false` when the key was taken. It is atomic: of several callers racing for the same key, on one server or many, exactly one gets `true`. Use it for idempotency markers, claims and "first writer wins" records:

```ts
// Process a webhook once, however many times it is delivered.
if (!(await files.putIfAbsent(`webhooks/${event.id}`, JSON.stringify(event)))) return
await handle(event)
```

Buckets use S3 conditional writes (`If-None-Match: *`), which AWS S3, Cloudflare R2 and MinIO support. Disk uses an atomic hard link. A stream is written as it arrives: on a bucket, a body larger than one part goes up in parts, and completing the upload is the conditional step, so two large writers racing for one key still leave exactly one.

## Joining objects in the bucket: `compose`

`s3Storage` has `compose(key, sources)`, which joins objects already in the bucket into `key`, in order. The bucket does the copying (CopyObject, or UploadPartCopy in ranges of up to 5 GiB), so the bytes never pass through your server:

```ts
await files.compose('reports/2026.csv', ['reports/q1.csv', 'reports/q2.csv', 'reports/q3.csv'])
```

S3 requires every part except the last to be at least 5 MiB. If an earlier source is smaller, `compose` streams the sources through instead, so it always works and copies inside the bucket whenever it can. `files.location` is the bucket's address: two storages with the same `location` are the same bucket.

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

### Size unknown up front: `uploadForm()`

`uploadUrl()` fixes the exact size, so the browser must say it first. `uploadForm()` signs a form (an S3 POST policy) that accepts any size within a range instead. The bucket enforces the range, the key and the content type:

```ts
const TYPES = ['image/png', 'image/jpeg', 'application/pdf']

@Post('/uploads/form')
async form(ctx: RequestContext) {
  const { type } = ctx.body as { type: string }
  if (!TYPES.includes(type)) throw HttpException.badRequest('Unsupported type')
  const key = `uploads/${ctx.get('user')!.id}/${randomUUID()}`
  ctx.json(await this.files.uploadForm(key, { maxSize: 20 * 1024 * 1024, contentType: type }))
}
```

```ts
// browser: the fields first, the file last
const { url, fields } = await api.post('/uploads/form', { type: file.type })
const form = new FormData()
for (const [name, value] of Object.entries(fields)) form.append(name, value)
form.append('file', file)
await fetch(url, { method: 'POST', body: form })
```

The bucket rejects a file over `maxSize` with `EntityTooLarge`, and a different key or `Content-Type` with 403. `contentType` takes one exact type: a family such as `image/*` would also admit `image/svg+xml`, which can carry script, so check the client's declared type against your own list and sign that one. AWS S3 and MinIO support form uploads; Cloudflare R2 doesn't, so use `uploadUrl()` with `size` there. The bucket's CORS rule must allow `POST`.

### Large and resumable: `multipart`

A multipart upload sends the file in parts, each through its own signed URL. A dropped connection costs one part, not the whole file. If the page reloads, `listParts()` says which parts the bucket already has, so only the rest are sent. The server needs five endpoints:

```ts
@Controller()
class MultipartController {
  @Autowired(STORAGE) private files!: S3Storage

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
      storage: STORAGE, // a Storage, or a token bound to one
      maxSize: 2 * 1024 ** 3,
      onCreate: ({ headers, metadata, size }, id) => {
        const user = verifyToken(headers.authorization) // throw HttpException.unauthorized() to refuse
        if (!['video/mp4', 'application/pdf'].includes(metadata.filetype)) {
          throw HttpException.badRequest('Unsupported file type')
        }
        // The type the file is served as: only after checking it, as above.
        return {
          key: `uploads/${user.id}/${id}`,
          data: { owner: user.id },
          contentType: metadata.filetype,
        }
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

- **Arrival.** Each request's bytes are kept as a chunk in `partials`, a `Storage` of its own: by default a `diskStorage` under `dir` (`.tus`). If the connection drops, the bytes already received are kept, and the client asks (`HEAD`) where to continue and sends only the rest. tus-js-client remembers upload URLs across page reloads.
- **Completion.** When the last byte arrives, the file is streamed into `storage` under the key `onCreate` chose (default `uploads/<id>`), with the `contentType` `onCreate` returned, or `application/octet-stream` without one. The client's `metadata.filetype` is never used as-is: a client could declare `text/html` and turn the file into a page that runs script. Check it against your own list and return it, as in the example. Then `onComplete` runs. The response to that last request waits for both, so a client that sees success knows the file is stored. If storing or `onComplete` fails, the client gets a 500 and its retry runs both again. So `onComplete` runs at least once, and can run twice if it succeeded but the step after it failed. Make it idempotent, for example an upsert keyed by `upload.id`.
- **Checks.** `onCreate` sees every new upload's headers, size and metadata before anything is written. `authorize` sees every later request to that upload. Without `authorize`, anyone holding an upload's URL, which contains an unguessable id, can continue or cancel it. Throw an `HttpException` from either hook to refuse with its status.
- **Limits.** `maxSize` (default 1 GiB) is checked against the declared length, and the body can never run past it. An upload takes at most 10,000 PATCH requests: each one is a chunk object and a marker, so a client sending tiny chunks can't multiply them. That is plenty for a 1 GiB file in 1 MiB chunks, and tus-js-client and Uppy send one chunk by default. Unfinished uploads expire `expiresIn` seconds (default one day) after their last write and are swept hourly.
- **Middleware.** The adapter runs after the global middleware, so `cors()`, rate limits and `csrf()` apply. Pass the CSRF header through tus-js-client's `headers`. For a browser on another origin, `cors()` must expose the tus headers: `exposedHeaders: ['Location', 'Upload-Offset', 'Upload-Length', 'Upload-Expires', 'Tus-Resumable']`.
- **Finishing in the bucket.** When `storage` and `partials` are the same bucket (same `location`), the finished file is joined from its chunks with `compose`, inside the bucket. Chunks of at least 5 MiB are copied, so set tus-js-client's `chunkSize` to 5 MiB or more for large files. Smaller ones stream through.
- **Several instances.** Pass a `partials` that every instance shares, such as a bucket (`partials: s3Storage({...})`, or a DI token), and any instance can take any request of any upload. No sticky sessions or locks are needed: a chunk counts once its commit marker is written with `putIfAbsent`, so of two requests racing to write the same offset, one wins and the other gets 409 and asks `HEAD` again. With the default local `partials`, have the load balancer send an upload's requests to one instance. Unfinished uploads live under `tus/` in `partials`, so final keys under `tus/` are refused: with one bucket for both, such a key could overwrite another upload's records.

The protocol is tus 1.0.0 with the creation, creation-with-upload, termination, expiration, checksum and concatenation extensions:

- **Checksums.** A client that sends `Upload-Checksum` (`sha1`, `sha256` or `md5`) has each chunk checked. A mismatch answers 460 and drops the chunk, and the client sends it again.
- **Parallel uploads.** With concatenation, a client splits a file into parts uploaded at once and then creates a final upload that joins them. Pass `parallelUploads: 3` to tus-js-client. `onCreate` sees `concat: 'partial'` for each part and `concat: 'final'` for the join, and `authorize` checks every part the final upload names. Only the final upload reaches the storage and runs `onComplete`.

For a server that isn't KickJS, `createTusHandler(options)` from the same entry is the same endpoint as a Node `(req, res, next)` handler.

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
import { StorageAdapter } from '@forinda/kickjs-storage/adapter'
import { s3FromSettings } from '@forinda/kickjs-storage/settings'

bootstrap({ modules, adapters: [StorageAdapter({ storage: s3FromSettings() })] })
```

`s3FromSettings()` reads the section on first use, after the app has bound it, and `StorageAdapter` declares the section, so the app validates it at startup. Without the adapter, list it yourself: `bootstrap({ settings: [S3Settings] })`. A missing `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY`, an `S3_ENDPOINT` that isn't a URL, or an `S3_FORCE_PATH_STYLE` other than `true` / `false`, stops startup with every problem listed.

A second bucket reads its own variables through `S3Settings.scoped('BACKUPS')`, which reads `BACKUPS_S3_BUCKET`, `BACKUPS_S3_ACCESS_KEY_ID`, and so on. Pass it as `s3FromSettings(Backups)`; the adapter that takes that storage declares it.

## In tests

Override `STORAGE` with `memoryStorage()` and read back what the handler stored:

```ts
const files = memoryStorage()
const { client } = await createTestApp({
  modules,
  overrides: [[STORAGE, files]],
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

- **Direct and multipart uploads are bucket only.** `uploadUrl()`, `uploadForm()` and `multipart` exist on `s3Storage` (typed `S3Storage`), not on disk or memory. In development, run MinIO, as shown in [In tests](#in-tests).
- **Disk can't hold both `a` and `a/b`.** On disk, a key is a file and a key prefix is a folder, so `put('a/b')` after `put('a')`, or the reverse, throws a clear error. Buckets and memory allow both.
- **Disk doesn't follow symbolic links.** A key that leads through a link inside the root, or names a link, is refused, so a link can't expose files outside the root.
- **`contentType`** is kept by buckets and memory, and ignored by disk. For disk, the server serving the files picks the type from the extension.
- **Edge runtimes.** `memoryStorage` and `s3Storage` run on Workers, Bun and Deno, so a Worker can reach R2 through its S3 API with an access key. `diskStorage`, `TusAdapter` and the settings entry are Node only.
