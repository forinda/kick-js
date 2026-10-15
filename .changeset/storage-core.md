---
'@forinda/kickjs-storage': minor
---

- **Edge runtimes.** The main entry runs on Node, Bun, Deno and Cloudflare Workers: `s3Storage` signs with WebCrypto and uses no `Buffer`. `diskStorage` moves to `@forinda/kickjs-storage/disk`.
- **Parallel streamed uploads.** `put()` with a stream uploads `partConcurrency` parts at once (default 4), and `partSize` sets the part size (at least 5 MiB).
- **Create-only writes.** `putIfAbsent(key, body)` is an atomic create-only write on every driver: S3 conditional writes on buckets, a hard link on disk.
- **Faster disk listing.** `diskStorage.list()` reads only the folders a page needs instead of the whole tree.
