# @forinda/kickjs-storage

One `Storage` interface over memory, local disk, and S3-compatible buckets, with signed URLs and no AWS SDK. The [File Storage guide](../guide/file-storage.md) covers usage.

## Installation

<PmCommand add="@forinda/kickjs-storage" />

## Exports

| Export                           | Description                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Storage`                        | `put`, `get` (`null` when missing), `exists`, `delete`, `url`                                               |
| `memoryStorage(options?)`        | Files in a `Map`, for tests. `baseUrl` for `url()`                                                          |
| `diskStorage(options)`           | Files under `root`, written atomically. `baseUrl` for `url()`                                               |
| `s3Storage(options)`             | S3, R2, MinIO over `fetch` with SigV4. `url()` presigns a GET                                               |
| `checkKey(key)`                  | Throws for an empty key, a leading `/`, empty / `.` / `..` segments, `\` or NUL                             |
| `S3Storage`                      | `Storage` plus `uploadUrl(key, { size, contentType, expiresIn })` and `multipart`                           |
| `Multipart`                      | `create`, `partUrl`, `listParts`, `complete`, `abort`                                                       |
| `UploadUrlOptions`               | `expiresIn`, `size` (signed, exact), `contentType` (signed)                                                 |
| `UploadedPart` / `CompletedPart` | `{ partNumber, etag, size }` / `{ partNumber, etag }`                                                       |
| `Body`                           | `Uint8Array \| string \| AsyncIterable<Uint8Array>` (web or Node streams)                                   |
| `FileInfo`                       | `key`, `size`, `lastModified`, `contentType?`                                                               |
| `ListOptions` / `ListPage`       | `prefix`, `cursor`, `limit` (1 to 1000) / `files`, `cursor?`                                                |
| `PutOptions`                     | `contentType`                                                                                               |
| `UrlOptions`                     | `expiresIn` in seconds, default 3600, at most 604800                                                        |
| `S3StorageOptions`               | `bucket`, `region`, `endpoint`, `accessKeyId`, `secretAccessKey`, `sessionToken`, `forcePathStyle`, `fetch` |
| `DiskStorageOptions`             | `root`, `baseUrl`                                                                                           |
| `MemoryStorageOptions`           | `baseUrl`                                                                                                   |

### Settings (`@forinda/kickjs-storage/settings`)

Needs `@forinda/kickjs` 10.1 or later.

| Export                               | Description                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `S3Settings`                         | Section `S3`: `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_SESSION_TOKEN`, `S3_FORCE_PATH_STYLE` |
| `s3FromSettings(section?, options?)` | An `S3Storage` read from the section on first use; set variables win over `options`                                                          |
