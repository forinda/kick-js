# @forinda/kickjs-storage

## 0.6.0

### Minor Changes

- [#1130](https://github.com/forinda/kick-js/pull/1130) [`0c163d4`](https://github.com/forinda/kick-js/commit/0c163d40062ea47f7afcebc5494500956c1d91ce) Thanks [@forinda](https://github.com/forinda)! - `acl` for S3 buckets: a canned ACL (`'public-read'`, …) sent, signed, on every write a storage makes — `put`, `putIfAbsent`, `compose`, `multipart.create`, `uploadForm` and `uploadUrl` (signed into the URL). Each of those also takes its own `acl`, over the storage's. `S3Settings` reads it from `S3_ACL`.
  
  `s3Configured(section?)` from `@forinda/kickjs-storage/settings`: true when the section's bucket is set (`S3_BUCKET` or `S3_BUCKET_FILE`). The `kick add storage` file now picks its driver with it instead of reading `process.env.S3_BUCKET`, which missed a bucket kept in a secret file.

- [#1133](https://github.com/forinda/kick-js/pull/1133) [`6fcf09c`](https://github.com/forinda/kick-js/commit/6fcf09c9b7c1a9bf92b47ad89786510f58b7d624) Thanks [@forinda](https://github.com/forinda)! - S3 buckets: `storageClass` (`'STANDARD_IA'`, `'GLACIER_IR'`, …) on the storage and on each write, returned by `stat()`; and `publicUrl(key)`, the unsigned address of a public file, from the bucket or a `publicUrl` option such as a CDN. `S3Settings` reads `S3_STORAGE_CLASS` and `S3_PUBLIC_URL`, and the `kick add storage` `.env.example` lists them.

- [#1134](https://github.com/forinda/kick-js/pull/1134) [`daa15e8`](https://github.com/forinda/kick-js/commit/daa15e854a7cfcb69396a04275a55829a4cc429d) Thanks [@forinda](https://github.com/forinda)! - `deleteMany(keys)` on S3 buckets: up to 1000 files per request (DeleteObjects) instead of one request each, with the `Content-MD5` every S3 API accepts. Missing keys count as deleted. The error names keys the bucket refuses, those of earlier batches included when a later request fails.

- [#1132](https://github.com/forinda/kick-js/pull/1132) [`fa1ccc6`](https://github.com/forinda/kick-js/commit/fa1ccc6e3bca26236a0ffd9d2c3617194f8accbf) Thanks [@forinda](https://github.com/forinda)! - S3 buckets:
  
  - **Retries:** a request that can't connect, times out, or gets 500/502/503/504 is sent again with backoff, up to `maxAttempts` (default 3; `1` turns retries off), as the AWS SDK does. `putIfAbsent` is retried only when S3 refused it before writing, so a write that may have landed isn't reported as taken.
  - **Per-file headers and metadata:** `cacheControl`, `contentDisposition`, `contentEncoding`, `contentLanguage` and `metadata` (`x-amz-meta-*`) on `put`, `putIfAbsent`, `compose`, `multipart.create`, `uploadUrl` and `uploadForm`. `stat()` returns them.

### Patch Changes

- [#1135](https://github.com/forinda/kick-js/pull/1135) [`3c0ce8d`](https://github.com/forinda/kick-js/commit/3c0ce8d404186eeadc8111ae2311c7f8233ddb84) Thanks [@forinda](https://github.com/forinda)! - S3 buckets retry what the AWS SDK retries:
  
  - 429
  - S3's 400 `RequestTimeout`
  - a clock-skew error. The storage then signs with the bucket's time from then on, signed URLs included. A `HEAD` (`stat`, `exists`) carries no error code, so a 403 whose `Date` is more than 15 minutes off counts as skew.
  - a CopyObject, UploadPartCopy or CompleteMultipartUpload that answers 200 with an error or with no body. An empty 200 used to count as success. Two exceptions:
    - `PreconditionFailed`, a create-only write losing the race, is an answer, not a failure.
    - A create-only (`putIfAbsent`) completion that fails this way isn't retried, since the write may have happened. It's reported as a failure, and the upload is aborted.
  
  `putIfAbsent` is retried only when S3 refused it before writing: 503, 429, `RequestTimeout`, clock skew.
  
  `get` and `getStream` return a file stored with `contentEncoding: 'gzip'` as stored: `fetch` decompressed it before. Header values with runs of spaces are signed as S3 checks them.

## 0.5.0

### Minor Changes

- [#1125](https://github.com/forinda/kick-js/pull/1125) [`99fd210`](https://github.com/forinda/kick-js/commit/99fd210e345bdc116194b1f59588c48b47663926) Thanks [@forinda](https://github.com/forinda)! - `ensureBucket()` on an S3 storage creates the bucket when it's missing, returning `true` when it did. It names the region outside `us-east-1`, treats a concurrent create as success, and throws when the name is taken by another account or access is denied. Useful for a fresh MinIO in development and tests.

- [#1126](https://github.com/forinda/kick-js/pull/1126) [`2c830cf`](https://github.com/forinda/kick-js/commit/2c830cfdb747dafdd0553b49c9205b6fc5efba39) Thanks [@forinda](https://github.com/forinda)! - `s3Storage({ serverSideEncryption })` encrypts what the storage writes, with keys S3 manages (`{ type: 'AES256' }`) or a KMS key (`{ type: 'aws:kms', keyId? }`). The signed headers go on `put`, `putIfAbsent`, `compose`, `multipart.create` and `uploadForm`; `uploadUrl` doesn't carry them.

## 0.4.0

### Minor Changes

- [#1107](https://github.com/forinda/kick-js/pull/1107) [`30e5327`](https://github.com/forinda/kick-js/commit/30e53271dec8e80731a485b71f09671b01020228) Thanks [@forinda](https://github.com/forinda)! - Write your own storage driver. `@forinda/kickjs-storage/testing` exports `storageContract(name, make, { skip?, baseUrl? })`, the Vitest suite the built-in drivers run, so a driver for another service (Cloudinary, Azure Blob, an internal file API) can be checked against the same behaviour; `skip` leaves out what a backend deliberately can't do. The checks every driver makes are exported too, so a custom one throws the same errors: `checkKey`, `checkRange`, `checkLimit`, `checkDelimiter`, `collect` and `encodeKey`. The file storage guide has a new "Your own driver" section with the rules each method keeps and an example driver. `vitest` is an optional peer, needed only for `/testing`.

- [#1105](https://github.com/forinda/kick-js/pull/1105) [`434d510`](https://github.com/forinda/kick-js/commit/434d510bc96ffeefdd4862931ce2d3284e14f4c6) Thanks [@forinda](https://github.com/forinda)! - `StorageAdapter` takes a `settings` option: more sections to declare beside the storage's own. The file `kick add storage` writes passes `settings: [S3Settings.optional()]`, so `kick env example` keeps listing the `S3_*` variables while files are on disk instead of dropping the lines `kick add storage` appended; with `S3_BUCKET` set, the section is still required at startup. Those appended lines now match what `kick env example` writes. `@forinda/kickjs-storage` now needs `@forinda/kickjs` 10.14 or later, for `.optional()`.

## 0.3.2

### Patch Changes

- [#1103](https://github.com/forinda/kick-js/pull/1103) [`580cd20`](https://github.com/forinda/kick-js/commit/580cd207b6fa08bdc617c37497733ee9733f8b27) Thanks [@forinda](https://github.com/forinda)! - Settings sections can be declared `.optional()`: listed by `kick env example` and `app.describeConfig()`, but not validated or bound at startup — `get()` validates one when it's used. For a section only one driver reads, picked at run time (SMTP or Resend by `MAIL_DRIVER`, a bucket only production uses), which until now either had to be required at startup or was left out of `.env.example`. Works in every `settings` list: `bootstrap()`, modules, adapters and plugins. `kick env example` comments every variable of an optional section, marks the required ones "required when used", and writes a section schema's own description under its heading. The `S3Settings` variables now carry descriptions.

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
