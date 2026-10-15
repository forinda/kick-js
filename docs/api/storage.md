# @forinda/kickjs-storage

One `Storage` interface over memory, local disk, and S3-compatible buckets, with signed URLs and no AWS SDK. The main entry runs on Node, Bun, Deno and Cloudflare Workers; `diskStorage` is in `@forinda/kickjs-storage/disk`. The [File Storage guide](../guide/file-storage.md) covers usage.

## Installation

<PmCommand add="@forinda/kickjs-storage" />

## Exports

| Export                             | Description                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Storage`                          | `put`, `putIfAbsent`, `get`, `getStream`, `stat`, `exists`, `delete`, `list`, `url`                                                                                          |
| `memoryStorage(options?)`          | Files in a `Map`, for tests. `baseUrl` for `url()`                                                                                                                           |
| `diskStorage(options)`             | From `@forinda/kickjs-storage/disk` (Node only). Files under `root`, written atomically. `baseUrl` for `url()`                                                               |
| `s3Storage(options)`               | S3, R2, MinIO over `fetch` with SigV4. `url()` presigns a GET                                                                                                                |
| `checkKey(key)`                    | Throws for an empty key, a leading `/`, empty / `.` / `..` segments, `\` or NUL                                                                                              |
| `S3Storage`                        | `Storage` plus `uploadUrl(key, { size, contentType, expiresIn })`, `uploadForm(key, { maxSize, minSize, contentType })`, `multipart`, `compose(key, sources)` and `location` |
| `Multipart`                        | `create`, `partUrl`, `listParts`, `complete`, `abort`                                                                                                                        |
| `UploadFormOptions` / `UploadForm` | `maxSize`, `minSize`, `contentType` (one exact type), `expiresIn` / `{ url, fields }`                                                                                        |
| `UploadUrlOptions`                 | `expiresIn`, `size` (signed, exact), `contentType` (signed)                                                                                                                  |
| `UploadedPart` / `CompletedPart`   | `{ partNumber, etag, size }` / `{ partNumber, etag }`                                                                                                                        |
| `Body`                             | `Uint8Array \| string \| AsyncIterable<Uint8Array>` (web or Node streams)                                                                                                    |
| `FileInfo`                         | `key`, `size`, `lastModified`, `contentType?`                                                                                                                                |
| `ListOptions` / `ListPage`         | `prefix`, `delimiter`, `cursor`, `limit` (1 to 1000) / `files`, `prefixes?`, `cursor?`                                                                                       |
| `PutOptions`                       | `contentType`                                                                                                                                                                |
| `UrlOptions`                       | `expiresIn` in seconds, default 3600, at most 604800                                                                                                                         |
| `S3StorageOptions`                 | `bucket`, `region`, `endpoint`, `accessKeyId`, `secretAccessKey`, `sessionToken`, `forcePathStyle`, `fetch`, `partSize`, `partConcurrency`                                   |
| `DiskStorageOptions`               | `root`, `baseUrl`                                                                                                                                                            |
| `MemoryStorageOptions`             | `baseUrl`                                                                                                                                                                    |

### Settings (`@forinda/kickjs-storage/settings`)

Needs `@forinda/kickjs` 10.1 or later.

| Export                               | Description                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3Settings`                         | Section `S3`: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN`, `S3_FORCE_PATH_STYLE` |
| `s3FromSettings(section?, options?)` | An `S3Storage` read from the section on first use; set variables win over `options`                                                          |

### Adapter (`@forinda/kickjs-storage/adapter`)

Needs `@forinda/kickjs` 10.1 or later.

| Export                    | Description                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StorageAdapter(options)` | Binds `options.storage` to `options.token` (default `STORAGE`) and declares the storage's settings section, if it has one. `.scoped(name, options)` for a second storage |
| `STORAGE`                 | The default token                                                                                                                                                        |
| `StorageAdapterOptions`   | `storage`, `token`                                                                                                                                                       |

### tus (`@forinda/kickjs-storage/tus`)

Needs `@forinda/kickjs` 10.1 or later.

| Export                      | Description                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `TusAdapter(options)`       | A tus 1.0.0 endpoint at `path` (creation, creation-with-upload, termination, expiration, checksum, concatenation) on every runtime |
| `createTusHandler(options)` | The same endpoint as a Node `(req, res, next)` handler                                                                             |
| `TusOptions`                | `path`, `storage`, `partials`, `dir`, `maxSize`, `expiresIn`, `onCreate`, `authorize`, `onComplete`                                |
| `TusUpload`                 | `id`, `key`, `size`, `offset`, `metadata`, `data`, `expiresAt`, `concat?`                                                          |
| `TusCreateRequest`          | `headers`, `size`, `metadata`, `concat?`                                                                                           |
