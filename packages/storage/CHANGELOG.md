# @forinda/kickjs-storage

## 0.3.1

### Patch Changes

- [#995](https://github.com/forinda/kick-js/pull/995) [`a995470`](https://github.com/forinda/kick-js/commit/a995470711a112e317ba7c086f9394a20df6d0ae) Thanks [@forinda](https://github.com/forinda)! - The `@forinda/kickjs` peer range is now `>=10.1.0` with no upper bound, so the next kickjs major installs without a peer warning and doesn't force a storage release alongside it.

## 0.3.0

### Minor Changes

- [#993](https://github.com/forinda/kick-js/pull/993) [`cda21d0`](https://github.com/forinda/kick-js/commit/cda21d0e32bd4bf9d59d48e8809abd51f0dfe297) Thanks [@forinda](https://github.com/forinda)! - Ranged reads, IAM roles, timeouts and response headers on signed URLs.
  
  - `getStream(key, { start, end })` reads part of a file, for answering HTTP `Range` requests: `createReadStream` with `start`/`end` on disk, a `Range` header on a bucket, a slice in memory.
  - `s3Storage({ credentials })` takes a function that returns the current keys, instead of fixed `accessKeyId` / `secretAccessKey`, so an app on ECS, EC2 or EKS can use its role (`fromNodeProviderChain()` from `@aws-sdk/credential-providers`). `S3Settings` now accepts both keys unset; setting only one still fails startup.
  - `s3Storage({ timeoutMs })` aborts a request the bucket hasn't answered in time, so a slow bucket fails the route instead of hanging it.
  - `url(key, { contentType, contentDisposition, cacheControl })` signs S3's `response-*` parameters into the URL, so the bucket serves the file with those headers.
  - `diskStorage` reads of a key reached through a symbolic link now return `null` (a 404) instead of throwing. Writes through a link still throw.

## 0.2.0

### Minor Changes

- [#924](https://github.com/forinda/kick-js/pull/924) [`a6b8538`](https://github.com/forinda/kick-js/commit/a6b853876b5225123d0ead711053ee76c7adb1be) Thanks [@forinda](https://github.com/forinda)! - `StorageAdapter` reports to `/health/ready`: its `onHealthCheck()` lists one key (`list({ limit: 1 })`), so an unreachable bucket or rejected credentials mark it `down`. With S3, the credentials need list permission on the bucket for the check to pass.
  
  Migration: if your S3 credentials can't list the bucket, `/health/ready` now reports the storage `down` — grant `s3:ListBucket`, or pass `healthCheck: false` to `StorageAdapter`.

## 0.1.0

### Minor Changes

- [#899](https://github.com/forinda/kick-js/pull/899) [`e537e6e`](https://github.com/forinda/kick-js/commit/e537e6ef1fc2357ceafec8aad117417409039312) Thanks [@forinda](https://github.com/forinda)! - - **`S3Storage.compose(key, sources)`** joins objects inside the bucket, using CopyObject, or UploadPartCopy in even ranges of at most 5 GiB. It streams through when an earlier source is under S3's 5 MiB part minimum. `S3Storage.location` identifies the bucket.
  - **tus finishing with `compose`.** When `storage` and `partials` are the same bucket, `TusAdapter` joins a finished upload's chunks with `compose`, so the bytes don't pass through the server.
  - **tus cleanup.** The tus sweep walks an expiry index (`tus/_expiry/<hour>/<id>`) and reads only uploads that may have expired.
  - **Streamed `putIfAbsent`.** A stream body is no longer read into memory. Buckets upload it in parts and make completion the conditional step, and disk streams it to a temp file before the atomic link.
  - **Disk listing.** `diskStorage.list()` keeps each folder's sorted listing until the folder changes, and uses a binary search for the cursor. Paging through a huge folder reads it once.

- [#898](https://github.com/forinda/kick-js/pull/898) [`9f0417c`](https://github.com/forinda/kick-js/commit/9f0417cc3bc239aa909f473a925bfb8ca836bfa4) Thanks [@forinda](https://github.com/forinda)! - - **`StorageAdapter`** (from `@forinda/kickjs-storage/adapter`). It binds a storage to the `STORAGE` token, or a token of your own via `.scoped()`. For a storage from `s3FromSettings()`, it also declares that storage's settings section.
  - **`kick add storage` and `kick new --packages storage` now wire the package.**
    - They write `src/storage.ts`, which uses the `uploads/` folder until `S3_BUCKET` is set and then that bucket.
    - They add `storageAdapter()` to `bootstrap()`, the `S3_*` variables to `.env.example`, and `uploads/` and `.tus/` to `.gitignore`.

- [#896](https://github.com/forinda/kick-js/pull/896) [`03a3dd5`](https://github.com/forinda/kick-js/commit/03a3dd5c40949e73b1dacc47da4d3f74f4736a72) Thanks [@forinda](https://github.com/forinda)! - - **Edge runtimes.** The main entry runs on Node, Bun, Deno and Cloudflare Workers: `s3Storage` signs with WebCrypto and uses no `Buffer`. `diskStorage` moves to `@forinda/kickjs-storage/disk`.
  - **Parallel streamed uploads.** `put()` with a stream uploads `partConcurrency` parts at once (default 4), and `partSize` sets the part size (at least 5 MiB).
  - **Create-only writes.** `putIfAbsent(key, body)` is an atomic create-only write on every driver: S3 conditional writes on buckets, a hard link on disk.
  - **Faster disk listing.** `diskStorage.list()` reads only the folders a page needs instead of the whole tree.

- [#900](https://github.com/forinda/kick-js/pull/900) [`7d00e3e`](https://github.com/forinda/kick-js/commit/7d00e3ee4695166968b1ce67b932533897939b01) Thanks [@forinda](https://github.com/forinda)! - - **Folders in listings.** `list({ delimiter: '/' })` groups keys into folders and returns them in `prefixes`, with S3's `CommonPrefixes` semantics, on memory, disk and buckets. Files and prefixes page together.
  - **`S3Storage.uploadForm(key, { maxSize, minSize, contentType })`** signs a browser form upload (POST policy). The bucket enforces the size range, the key and one exact content type, so the browser doesn't need to declare the size first. Type families aren't accepted, because a family would admit `image/svg+xml`. Supported on AWS S3 and MinIO, not on Cloudflare R2.

- [#897](https://github.com/forinda/kick-js/pull/897) [`617a00b`](https://github.com/forinda/kick-js/commit/617a00b8f3f1ac4b43cfb96aec7d40ea44d784cc) Thanks [@forinda](https://github.com/forinda)! - - **Unfinished uploads in any `Storage`.** `TusAdapter` keeps unfinished uploads in `partials`, which can be any `Storage` (a local `diskStorage` by default). With a shared bucket, every instance can take any request of any upload, with no sticky sessions. Chunks commit through `putIfAbsent` markers, so two requests racing for one offset keep exactly one.
  - **Disconnects keep received bytes.** A client that disconnects mid-PATCH keeps the bytes that arrived.
  - **New tus extensions:** checksum (`Upload-Checksum` with sha1, sha256 or md5, and 460 on a mismatch) and concatenation (parallel uploads, as with tus-js-client's `parallelUploads`).

- [#895](https://github.com/forinda/kick-js/pull/895) [`61771ba`](https://github.com/forinda/kick-js/commit/61771bab80bbbacec18287e75da6a83415ea32fd) Thanks [@forinda](https://github.com/forinda)! - `@forinda/kickjs-storage/tus` adds `TusAdapter`: a tus 1.0.0 endpoint (creation, creation-with-upload, termination, expiration) for resumable uploads through your own server, with tus-js-client, Uppy and other tus clients. Unfinished uploads are written to a local directory as they arrive, and completed files move into any `Storage`. `onCreate`, `authorize` and `onComplete` hooks check who uploads what and record the result. It works on Express, Fastify and h3.
  
  `@forinda/kickjs` exports `RAW_BODY` (`Symbol.for('kick/http/raw-body')`). Middleware that reads the request stream itself sets it in an adapter's `beforeGlobal` phase, so the Express 415 for unparsed body types leaves that request alone.

- [#894](https://github.com/forinda/kick-js/pull/894) [`69ea446`](https://github.com/forinda/kick-js/commit/69ea44686b6eabac1a0443d0dacd1cbfdef23be1) Thanks [@forinda](https://github.com/forinda)! - Storage adds `list({ prefix, cursor, limit })`, `stat()` and `getStream()`, and `put()` takes a stream: disk writes it as it arrives, buckets upload it in 5 MiB parts. `s3Storage` adds uploads that go from the browser straight to the bucket. `uploadUrl(key, { size, contentType })` signs the exact size and type into the URL. `multipart` provides `create`, `partUrl`, `listParts`, `complete` and `abort` for large, resumable uploads (Uppy-compatible). `startService('minio')` starts an S3-compatible MinIO with a `test` bucket, and `startContainer` takes `entrypoint` and `command`.

- [#893](https://github.com/forinda/kick-js/pull/893) [`bd4109c`](https://github.com/forinda/kick-js/commit/bd4109c75f6548c488fe359ce71bcb08557608b2) Thanks [@forinda](https://github.com/forinda)! - New package `@forinda/kickjs-storage`: one `Storage` interface (`put`, `get`, `exists`, `delete`, `url`) over `memoryStorage()`, `diskStorage({ root, baseUrl })` and `s3Storage({ bucket, region, endpoint, forcePathStyle, ... })`. The S3 driver works with AWS S3, Cloudflare R2 and MinIO, signs its requests with SigV4 over `fetch` (no AWS SDK), and returns presigned URLs from `url()`. Keys that could escape the disk root or alias another object are refused. `@forinda/kickjs-storage/settings` adds an `S3Settings` section and `s3FromSettings()`. `kick add storage` installs it.

### Patch Changes

- [#893](https://github.com/forinda/kick-js/pull/893) [`f9749d4`](https://github.com/forinda/kick-js/commit/f9749d41e986b19323ad683e6d8518ca3538591a) Thanks [@forinda](https://github.com/forinda)! - tus: an upload takes at most 10,000 PATCH requests, and each instance keeps at most 1,000 uploads in its commit cache. With shared partials, an instance that served part of an upload but never saw it finish used to keep its cache entry forever.

- [#902](https://github.com/forinda/kick-js/pull/902) [`31c4a2b`](https://github.com/forinda/kick-js/commit/31c4a2bbe7d249f5c339be92dd51cf885ae99ea8) Thanks [@forinda](https://github.com/forinda)! - tus no longer stores a finished upload with the client's declared `metadata.filetype` as its `Content-Type`, because a client could declare `text/html` or `image/svg+xml` and get a page that runs script served from your storage. Files are stored as `application/octet-stream` unless `onCreate` returns a `contentType`, which must be one exact type and is meant to be checked against your allowlist.
